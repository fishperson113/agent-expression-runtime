import { createHash } from 'node:crypto';
import { PublicTextExcerpts } from './presentation-excerpts.mjs';
import { PublicTextCheckpoints } from './presentation-checkpoints.mjs';
import { NativePresentationProvider } from './presentation-provider.mjs';
import { presentationBody } from './presentation-body.mjs';
import { presentationSection } from '../src/live/presentation-section.mjs';
export { presentationSection };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Independent, best-effort public-text observer. Never awaited by the native relay.
export class LiveStreamingPresentationBridge {
  constructor({state,page,host,runtime,provider,now=Date.now,onEvent=()=>{},ttlMs=10000,checkpoints={},boundedSourceLease=false,exactExcerptLease=false,protocol='freeform'}) {
    if(!['freeform','diagram'].includes(protocol))throw Error('presentation_protocol_invalid');
    exactExcerptLease ||= protocol==='diagram';
    Object.assign(this,{state,page,now,onEvent,ttlMs:boundedSourceLease||exactExcerptLease?Math.min(ttlMs,10000):ttlMs,boundedSourceLease:boundedSourceLease||exactExcerptLease,exactExcerptLease});
    this.excerpts=new PublicTextExcerpts();
    this.provider=provider??new NativePresentationProvider({host,runtime,timeoutMs:30000,protocol});
    this.checkpoints=new PublicTextCheckpoints(checkpoints);
    this.flushes=new Map();this.serial=0;this.finalIds=new Map();this.closed=false;this.selected=null;this.active=null;this.pending=null;
  }
  emit(type,detail={}) { try {this.onEvent({type,at:this.now(),...detail});} catch {/* Telemetry cannot break chat. */} }
  remaining(job){
    const now=this.now();
    if(!Number.isFinite(now)||now<job.lastNow){this.browserFault=true;job.controller.abort();this.emit('drop',{code:'clock_regressed'});return 0;}
    job.lastNow=now;return Math.max(0,Math.min(job.expiresAt-now,job.monotonicDeadline-performance.now()));
  }
  async evaluate(fn,value,job,onLate){
    const signal=job?.controller.signal;let timer,abort,abandoned=false;
    try{return await Promise.race([
      Promise.resolve().then(()=>{if(signal?.aborted)throw Error('presentation_browser_cancelled');return this.page.evaluate(fn,value);}).then(result=>{if(abandoned)onLate?.(result);return result;}),
      new Promise((_,reject)=>{
        abort=()=>reject(Error('presentation_browser_cancelled'));
        if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>{this.browserFault=true;this.emit('browser_unavailable',{code:'presentation_browser_timeout'});reject(Error('presentation_browser_timeout'));},Math.max(1,Math.min(this.browserTimeoutMs??3000,job?this.remaining(job):3000)));
      })]);
    }finally{abandoned=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  invalidate() {
    clearTimeout(this.holdTimer);this.selected?.controller?.abort();this.serial++;this.selected=null;this.pending=null;this.active?.controller.abort();this.finalIds.clear();this.checkpoints.revoke();this.excerpts.revoke();this.sectionKey=null;
    for(const timer of this.flushes.values())clearTimeout(timer);this.flushes.clear();
    if(!this.browserFault)void this.evaluate(()=>window.fischLive?.revokePresentation?.()).catch(()=>{});
  }
  close(){this.closed=true;this.invalidate();this.provider.close?.();}
  observe(message) { try {this.observePublic(message);} catch(error){this.emit('error',{code:error.message});this.invalidate();} }
  observePublic(message) {
    if(this.closed||this.browserFault||message.params?.threadId!==this.state.output.thread)return;
    const p=message.params;
    if(['item/started','item/completed'].includes(message.method)&&p.item?.type==='agentMessage'&&p.item.phase==='final_answer') {
      this.finalIds.set(p.turnId,p.item.id);if(this.finalIds.size>64)this.finalIds.delete(this.finalIds.keys().next().value);
    }
    if(!['item/agentMessage/delta','item/completed','turn/completed'].includes(message.method))return;
    const turnId=p.turnId??p.turn?.id, messageId=this.finalIds.get(turnId);if(!messageId)return;
    const snapshot=this.state.conversation.snapshot();
    const answer=snapshot.messages.find(m=>m.id===messageId&&m.turn===turnId&&m.role==='assistant');
    const user=snapshot.messages.find(m=>m.turn===turnId&&m.role==='user');
    if(!answer||!user)return;
    if(answer.truncated||!['streaming','completed'].includes(answer.status)){this.invalidate();return;}
    if(this.selected&&(this.selected.messageId!==messageId||this.selected.turnId!==turnId))this.invalidateSource('message_changed');
    const section=presentationSection(answer.text);
    const sectionKey=JSON.stringify([this.state.channel.token,this.state.output.thread,turnId,messageId,section]);
    if(this.sectionKey!==sectionKey){this.sectionKey=sectionKey;this.sectionPublishedAt=this.now();}
    if(!this.boundedSourceLease&&this.selected&&this.selected.section!==section)this.invalidateSource('section_changed');
    const id={documentId:this.state.channel.token,threadId:this.state.output.thread,turnId,messageId};
    const result=(this.exactExcerptLease?this.excerpts:this.checkpoints).update({...id,text:answer.text,at:this.now(),completed:answer.status==='completed'});
    if(result.revoked)this.invalidateSource(result.reason);
    if(!result.checkpoint){
      const key=JSON.stringify([turnId,messageId,answer.text.length]);
      if(answer.status==='completed'&&!this.flushes.has(key)) {
        const serial=this.serial;
        this.flushes.set(key,setTimeout(()=>{if(!this.closed&&serial===this.serial)this.observe(message);},this.checkpoints.config.cooldownMs+1));
        if(this.flushes.size>64){clearTimeout(this.flushes.values().next().value);this.flushes.delete(this.flushes.keys().next().value);}
      }
      return;
    }
    const cp=result.checkpoint;
    if(Buffer.byteLength(cp.textPrefix)>64000){this.emit('drop',{code:'public_prefix_capacity'});return;}
    const sourceAt=cp.sourceAt??this.sectionPublishedAt;
    const job={...id,controller:new AbortController(),lastNow:this.now(),monotonicDeadline:performance.now()+Math.max(0,sourceAt+Math.min(this.ttlMs,this.exactExcerptLease?10000:Infinity)-this.now()),section:this.exactExcerptLease?presentationSection(cp.textPrefix):section,serial:this.serial,checkpoint:cp,generation:snapshot.generation,publicRevision:snapshot.revision,
      userText:user.text,sourceAt,sectionPublishedAt:this.sectionPublishedAt,expiresAt:sourceAt+Math.min(this.ttlMs,this.exactExcerptLease?10000:Infinity),
      sourceHash:createHash('sha256').update(cp.textPrefix).digest('hex')};
    job.sourceStart=Math.max(job.section,cp.sourceStart);job.sourceEnd=cp.sourceEnd;
    job.sourceQuote=cp.target??cp.textPrefix.slice(job.sourceStart,job.sourceEnd);
    if(cp.textPrefix.slice(job.sourceStart,job.sourceEnd)!==job.sourceQuote){this.emit('drop',{code:'source_binding_invalid'});return;}
    this.emit('checkpoint',{sourceAt,revision:cp.checkpointRevision,sourceStart:Math.max(job.section,cp.sourceStart),previousCheckpointEnd:cp.previousEnd,sourceEnd:cp.sourceEnd,publishedAt:cp.observedAt,sectionPublishedAt:job.sectionPublishedAt,sourceHash:job.sourceHash});
    if(this.boundedSourceLease&&this.selected?.admitted&&this.valid(this.selected)&&this.now()<this.selected.holdUntil){this.pending=job;this.emit('coalesced',{revision:cp.checkpointRevision});this.scheduleDrain();return;}
    if(!this.boundedSourceLease&&this.selected?.admitted&&this.selected.section===section&&this.valid(this.selected)){this.emit('covered',{revision:cp.checkpointRevision});return;}
    if(this.active&&(this.boundedSourceLease||this.selected?.section===section)&&this.valid(this.selected)){this.pending=job;this.emit('coalesced',{revision:cp.checkpointRevision});return;}
    this.dispatch(job);
  }
  dispatch(job){this.invalidateSource();job.serial=this.serial;this.selected=job;this.pending=job;
    void this.selectBrowser(job).catch(error=>this.emit('error',{code:error.message}));}
  invalidateSource(reason='source_selected'){clearTimeout(this.holdTimer);if(this.selected)this.emit('source_revoked',{revision:this.selected.checkpoint.checkpointRevision,reason});this.selected?.controller?.abort();this.serial++;this.selected=null;this.pending=null;this.active?.controller.abort();
    this.revocation=this.browserFault?Promise.resolve():this.evaluate(()=>window.fischLive?.revokePresentation?.()).catch(()=>{});}
  valid(job){const s=this.state.conversation.snapshot();return !this.closed&&!this.browserFault&&this.selected===job&&this.remaining(job)>0&&
    !this.state.channel.stale&&s.available&&!s.pending&&!s.stopping&&!s.error&&s.messages.filter(m=>m.role==='user').at(-1)?.turn===job.turnId&&s.generation===job.generation&&
    (!s.ownerTurn||s.ownerTurn===job.turnId)&&this.state.channel.token===job.documentId&&this.state.output.thread===job.threadId&&
    s.messages.some(m=>m.id===job.messageId&&m.turn===job.turnId&&!m.truncated&&['streaming','completed'].includes(m.status)&&m.text.startsWith(job.checkpoint.textPrefix)&&(this.boundedSourceLease||presentationSection(m.text)===job.section));}
  async selectBrowser(job){
    await this.revocation;
    for(let n=0;n<20&&this.valid(job);n++){
      // Recheck both wall and monotonic elapsed time inside the browser; delayed
      // execution and wall-clock rollback must not renew the original source lease.
      job.scene=await this.evaluate(({identity,expiresAt,sentWall,monotonicDeadline,remainingMs})=>{const wall=Date.now(),left=Math.min(remainingMs,expiresAt-wall,monotonicDeadline-(performance.timeOrigin+performance.now()));if(wall<sentWall||left<=0)return null;return window.fischLive?.presentationSnapshot?.({...identity,remainingTtlMs:Math.min(30000,left)});},
        {identity:{documentId:job.documentId,threadId:job.threadId,turnId:job.turnId,generation:job.generation,messageId:job.messageId,
          textPrefix:job.checkpoint.textPrefix,publicRevision:job.publicRevision,section:job.section,sourceStart:job.sourceStart,sourceEnd:job.sourceEnd,sourceQuote:job.sourceQuote},expiresAt:job.expiresAt,sentWall:Date.now(),monotonicDeadline:performance.timeOrigin+job.monotonicDeadline,remainingMs:this.remaining(job)},job);
      if(job.scene?.scope)break;await sleep(50);
    }
    if(!this.valid(job)||!job.scene?.scope){this.emit('drop',{code:'source_unavailable',revision:job.checkpoint.checkpointRevision});return;}
    this.drain();
  }
  scheduleDrain(){clearTimeout(this.holdTimer);this.holdTimer=setTimeout(()=>this.drain(),Math.max(1,(this.selected?.holdUntil??this.now())-this.now()));}
  drain(){
    if(this.active||!this.pending)return;
    if(this.boundedSourceLease&&this.selected?.admitted&&this.valid(this.selected)&&this.now()<this.selected.holdUntil){this.scheduleDrain();return;}
    if(this.pending!==this.selected){const next=this.pending;if(this.now()>=next.expiresAt){this.pending=null;return;}this.dispatch(next);return;}
    if(!this.pending.scene?.scope)return;
    const job=this.pending;this.pending=null;if(!this.valid(job))return;
    const controller=job.controller;this.active={job,controller};this.emit('author_start',{revision:job.checkpoint.checkpointRevision});
    const timer=setTimeout(()=>{this.emit('source_expired',{revision:job.checkpoint.checkpointRevision});controller.abort();},Math.max(1,this.remaining(job)));
    let admission=Promise.resolve();
    void Promise.resolve().then(()=>this.provider.generate({userText:job.userText,assistantText:job.checkpoint.sourceText,
      target:job.sourceQuote,
      ...(this.exactExcerptLease?{publicContext:job.checkpoint.textPrefix.slice(-4096)}:{})},controller.signal,{partIds:job.scene.partIds},{
      isCurrent:()=>this.valid(job),onConfiguration:config=>this.emit('configuration',{revision:job.checkpoint.checkpointRevision,config}),onRejectedRecord:value=>this.emit('rejected_record',{revision:job.checkpoint.checkpointRevision,...value}),onPhase:phase=>this.emit('phase',{revision:job.checkpoint.checkpointRevision,phase}),onUsage:usage=>this.emit('usage',{revision:job.checkpoint.checkpointRevision,usage}),onRecord:record=>{admission=this.apply(job,record);admission.catch(()=>{});}
    })).then(()=>admission).catch(error=>{this.emit('drop',{code:error.message,revision:job.checkpoint.checkpointRevision});
      if(this.selected===job){const next=this.pending;this.invalidateSource();if(next!==job)this.pending=next;} // Revoke lease, not a previously rendered atomic record.
    }).finally(()=>{
      if(!this.boundedSourceLease&&job.admitted&&this.pending?.section===job.section)this.pending=null;
      clearTimeout(timer);this.emit('author_end',{revision:job.checkpoint.checkpointRevision});this.active=null;this.drain();});
  }
  async apply(job,record){
    if(!this.valid(job))return;
    const body=presentationBody(record,job.scene.scope);if(!body){this.emit('retain',{revision:job.checkpoint.checkpointRevision});return;}
    let receipt;
    while(this.valid(job)){
      receipt=await this.evaluate(value=>value.diagram?window.fischLive?.applyDiagramPresentation?.(value):window.fischLive?.applyPresentation?.(value),{scope:job.scene.scope,body,...(record.annotations?{annotations:record.annotations}:{}),...(record.diagram?{diagram:record.diagram}:{})},job,late=>{if(late?.status==='accepted')this.emit('admitted_stale',{revision:job.checkpoint.checkpointRevision,sourceHash:job.sourceHash});}).catch(error=>{this.emit('admission_unknown',{code:error.message,revision:job.checkpoint.checkpointRevision,sourceHash:job.sourceHash});throw error;});
      if(receipt?.code!=='presentation_busy')break;await sleep(50);
    }
    const accepted=receipt?.status==='accepted',current=this.valid(job);
    if(accepted&&current){job.admitted=true;job.holdUntil=Math.min(job.expiresAt,this.now()+2500);}
    // A received acceptance is physical history, not proof its source is still current.
    // The source invalidator owns revocation; a late receipt must not revoke a newer lease.
    this.emit(accepted?(current?'admitted':'admitted_stale'):'drop',{code:receipt?.code,revision:job.checkpoint.checkpointRevision,
      sourceAt:job.sourceAt,publishedAt:job.checkpoint.observedAt,lagMs:this.now()-job.checkpoint.observedAt,sourceHash:job.sourceHash});
  }
}
