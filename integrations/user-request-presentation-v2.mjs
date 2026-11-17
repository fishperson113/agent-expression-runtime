import {createHash} from 'node:crypto';
import {UserRequestLeaseV2} from '../src/live/user-request-lease-v2.mjs';
import {LiveStreamingPresentationBridge} from './presentation-streaming-bridge.mjs';
import {visualModelOptions} from './presentation-model-options.mjs';
import {NativePresentationProvider} from './presentation-provider.mjs';
import {presentationBody} from './presentation-body.mjs';
import {revokeFreeformReceipt} from './presentation-freeform-staging.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Explicit experimental construction only; native requests and default bridge stay unchanged.
export class UserRequestPresentationBridgeV2 extends LiveStreamingPresentationBridge {
 constructor(options){
  const {provider,visualModel,visualEffort,...rest}=options;
  if(options.protocol!==undefined&&options.protocol!=='freeform')throw Error('presentation_user_options');
  const modelOptions=visualModelOptions(visualModel,visualEffort);
  if(provider&&Object.keys(modelOptions).length)throw Error('presentation_model_provider_conflict');
  const author=provider??new NativePresentationProvider({host:options.host,runtime:options.runtime,timeoutMs:30000,protocol:'freeform',...modelOptions,userRequestV2:true});
  super({...rest,boundedSourceLease:true,provider:author});
  this.userRequests=new UserRequestLeaseV2();
  this.userRequests.enable(this.state.channel.token,this.state.conversation.snapshot());
  this.previewReady=this.evaluate(({documentId,snapshot})=>{const api=window.fischLive;if(!api)return false;api.conversationDocument=documentId;api.conversationStatus?.(snapshot);return api.configureUserRequestPreviewV2?.();},{documentId:this.state.channel.token,snapshot:this.state.conversation.snapshot()}).then(value=>value===true);
  this.previewReady.catch(()=>{});
 }
 invalidate(){this.userRequests?.retire();super.invalidate();}
 observe(message){this.observeUserRequestV2();super.observe(message);}
 observeUserRequestV2(){
  if(this.closed||this.browserFault||this.visualUnavailable)return;
  const previous=this.userRequests.current,u=this.userRequests.observe(this.state.channel.token,this.state.conversation.snapshot());
  if(previous&&!this.userRequests.current&&this.selected?.sourceRole==='user_request')this.invalidateSource('user_request_retired');
  if(!u||this.userAttempt===u.sourceVersion)return;
  const obsolete=job=>job&&['documentId','threadId','generation','turnId'].every(k=>job[k]!==undefined&&u[k]!==undefined)&&
   ['documentId','threadId','generation','turnId'].some(k=>job[k]!==u[k]);
  // Keep current-turn assistant priority; only supersede proven prior-source work.
  if([this.active?.job,this.pending,this.selected].some(job=>job&&!obsolete(job)))return;
  const left=u.deadline-performance.now(),sourceAt=this.now()-(performance.now()-u.sourceAt);
  if(left<=0)return;
  const checkpoint={sourceText:u.text,textPrefix:u.text,target:u.text,publicContext:u.publicContext,sourceStart:0,sourceEnd:u.text.length,checkpointRevision:u.sourceVersion,observedAt:sourceAt};
  const job={...u,sourceRole:'user_request',userVersion:u.sourceVersion,userText:u.text,sourceAt,lastNow:this.now(),expiresAt:sourceAt+10000,monotonicDeadline:u.deadline,controller:new AbortController(),checkpoint,section:0,sourceStart:0,sourceEnd:u.text.length,sourceQuote:u.text,sourceHash:createHash('sha256').update(u.text).digest('hex')};
  this.userAttempt=u.sourceVersion;
  this.emit('checkpoint',{sourceRole:'user_request',sourceAt,revision:u.sourceVersion,sourceHash:job.sourceHash});this.dispatch(job);
 }
 invalidateSource(reason){
  if(reason==='message_changed'&&this.selected?.sourceRole==='user_request')return;
  super.invalidateSource(reason);
 }
 valid(job){
  if(job?.sourceRole!=='user_request')return super.valid(job);
  const u=this.userRequests.observe(this.state.channel.token,this.state.conversation.snapshot());
  return !!u&&u.sourceVersion===job.userVersion&&this.selected===job&&!this.closed&&!this.browserFault&&!this.visualUnavailable&&!this.state.channel.stale&&!job.controller.signal.aborted&&this.remaining(job)>0;
 }
 async selectBrowser(job){
  await this.revocation;if(!this.valid(job))return;
  if(!await this.previewReady||!this.valid(job))return;
  if(job.sourceRole==='user_request'){
   for(let n=0;n<20&&this.valid(job);n++){
    const value=await this.evaluate(identity=>window.fischLive?.userRequestSourceV2?.(identity),{documentId:job.documentId,threadId:job.threadId,generation:job.generation,turnId:job.turnId,messageId:job.messageId,sourceQuote:job.sourceQuote},job);
    if(value){job.browserSourceVersion=value.sourceVersion;break;}
    await sleep(Math.min(50,this.remaining(job)));
   }
   if(!job.browserSourceVersion||!this.valid(job)){this.emit('drop',{code:'user_request_publication_unavailable'});return;}
   // The ordinary browser preparation receives the typed role through this exact identity.
   return this.prepareUser(job);
  }
  job.userCapture=await this.evaluate(()=>window.fischLive?.captureUserRequestV2?.(),undefined,job);
  return super.selectBrowser(job);
 }
 async prepareUser(job){
  job.preparationTicket=await this.evaluate(()=>window.fischLive?.presentationPreparationTicket?.(),undefined,job);
  if(!this.valid(job)||!job.preparationTicket)return;
  const identity={sourceRole:'user_request',sourceVersion:job.browserSourceVersion,documentId:job.documentId,threadId:job.threadId,generation:job.generation,turnId:job.turnId,messageId:job.messageId,textPrefix:job.sourceQuote,sourceQuote:job.sourceQuote,sourceStart:0,sourceEnd:job.sourceEnd,section:0,publicRevision:job.publicRevision};
  const sentWall=Date.now(),remainingMs=this.remaining(job),deadline=performance.timeOrigin+job.monotonicDeadline;
  job.scene=await this.evaluate(value=>{const wall=Date.now(),left=Math.min(value.remainingMs,value.deadline-(performance.timeOrigin+performance.now()));if(wall<value.sentWall||left<=0)return null;return window.fischLive?.preparePresentation?.({...value.identity,remainingTtlMs:left},value.ticket);},{identity,ticket:job.preparationTicket,sentWall,remainingMs,deadline},job);
  if(this.valid(job)&&job.scene?.scope)this.drain();
 }
 async apply(job,record){
  if(job.sourceRole==='user_request'||!job.userCapture)return super.apply(job,record);
  if(!this.valid(job))return;
  if(!['compose','retain'].includes(record.mode))throw Error('presentation_handoff_mode');
  const body=presentationBody(record,job.scene.scope),capture=job.userCapture;
  this.userRequests.tombstone(this.userRequests.current?.sourceVersion);
  let receipt;
  try {
   receipt=await this.evaluate(value=>window.fischLive?.handoffUserRequestV2?.(value),{capture,scope:job.scene.scope,body,retain:record.mode==='retain',replacement:record.mode==='compose'&&record.payload?.base==='none',...(record.annotations?{annotations:record.annotations}:{})},job,late=>{if(late?.status==='accepted')void revokeFreeformReceipt(this,late);});
   if(!['accepted','rejected','retained'].includes(receipt?.status))throw Error('presentation_handoff_unknown');
  }catch(error){this.browserFault=true;job.controller.abort();await revokeFreeformReceipt(this,capture.receipt);throw error;}
  job.userCapture=null;
  if(receipt.status==='accepted'){
   if(!this.valid(job)){await revokeFreeformReceipt(this,receipt);return;}
   job.admitted=true;job.displayedOwned={epoch:receipt.epoch,sceneRevision:receipt.sceneRevision,seq:receipt.seq};job.holdUntil=Math.min(job.expiresAt,this.now()+2500);
  }
  this.emit(receipt.status==='accepted'?'admitted':receipt.status==='retained'?'retain':'drop',{revision:job.checkpoint.checkpointRevision,sourceHash:job.sourceHash,code:receipt.code});
 }
}
