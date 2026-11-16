import {configureUserRequestPresentationV2} from '../integrations/live-terminal.mjs';
import {it,expect} from 'vitest';
import {runInNewContext} from 'node:vm';
import {UserRequestPresentationBridgeV2} from '../integrations/user-request-presentation-v2.mjs';
import {NativePresentationProvider} from '../integrations/presentation-provider.mjs';
const retain={mode:'retain',payload:null};
const timing=()=>({lastNow:Date.now(),expiresAt:Date.now()+9000,monotonicDeadline:performance.now()+9000});
const scene={mode:'compose',payload:{base:'none',parts:[{id:'dot',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]}]}};
const features=Object.fromEntries(['shell_tool','apps','plugins','multi_agent','computer_use','browser_use','image_generation','view_image'].map(k=>[k,false]));
class Rpc {
 static calls=[];static answer=JSON.stringify(retain);static count=0;
 constructor(_c,_a,_d,notify){this.notify=notify;this.settled=Promise.resolve();Rpc.count++;}
 close(){} send(){}
 async request(method,params){Rpc.calls.push({method,params});
  if(method==='config/read')return {config:{features,mcp_servers:{}}};
  if(method==='thread/start')return {thread:{id:'v'}};
  if(method==='mcpServerStatus/list')return {data:[]};
  if(method==='turn/start'){queueMicrotask(()=>{this.notify('item/completed',{threadId:'v',item:{id:'i',type:'agentMessage',phase:'final_answer',text:Rpc.answer}});this.notify('turn/completed',{threadId:'v',turn:{id:'t',status:'completed'}});});return {turn:{id:'t'}};}
  return {};
 }
}
const exchange={sourceRole:'user_request',target:'Please depict an abstract shape.',userText:'Please depict an abstract shape.',publicContext:'[user] Please depict an abstract shape.'};
const provider=options=>new NativePresentationProvider({host:{command:'fixture',args:[]},runtime:{cwd:'fixture',env:{}},Rpc,...options});
async function authored(options={},input=exchange){Rpc.calls=[];const p=provider(options),records=[];try{await p.generate(input,new AbortController().signal,{}, {isCurrent:()=>true,onRecord:r=>records.push(r)});return records;}finally{await p.close();}}
it('requires explicit user capability and exact own complete source before allocating RPC',async()=>{
 const before=Rpc.count;await expect(authored()).rejects.toThrow('presentation_user_source_unsupported');
 for(const input of [{...exchange,target:'different'},{...exchange,publicContext:'x'.repeat(4097)},{...exchange,target:'',userText:''}])await expect(authored({userRequestV2:true},input)).rejects.toThrow('presentation_user_source_invalid');
 expect(Rpc.count).toBe(before);
});
it('uses dedicated user framing and unchanged exact source/context with canonical records',async()=>{
 Rpc.answer=JSON.stringify(scene);expect(await authored({userRequestV2:true})).toEqual([scene]);
 const policy=Rpc.calls.find(c=>c.method==='thread/start').params.baseInstructions;
 expect(policy).toContain('not Codex');expect(policy).not.toContain('already public Codex explanation');
 const input=JSON.parse(Rpc.calls.find(c=>c.method==='turn/start').params.input[0].text);
 expect(input).toEqual({sourceRole:'user_request',userRequest:exchange.userText,target:exchange.target,publicContext:exchange.publicContext,scene:{}});
 expect(policy).toContain('contract v2.1');expect(policy).toContain('compose ONLY');expect(policy).toContain('base:none is the option');expect(policy).toContain('Retain remains valid');
});
it('permits retain but rejects unsupported wire and duplicate records rather than repairing',async()=>{
 Rpc.answer=JSON.stringify(retain);expect(await authored({userRequestV2:true})).toEqual([retain]);
 for(const raw of ['{"mode":"animate","payload":{}}',JSON.stringify(retain)+JSON.stringify(scene)]){
  Rpc.answer=raw;await expect(authored({userRequestV2:true})).rejects.toThrow();
 }
 Rpc.answer=JSON.stringify(retain);
});
it('assistant policy/input stays identical with capability off or on when no user role supplied',async()=>{
 const input={userText:'hello',assistantText:'public answer',target:'public answer'};
 await authored({},input);const before=Rpc.calls.filter(c=>['thread/start','turn/start'].includes(c.method));
 await authored({userRequestV2:true},input);expect(Rpc.calls.filter(c=>['thread/start','turn/start'].includes(c.method))).toEqual(before);
});
function fixture(author={close(){}}){
 const snapshot={available:true,pending:false,stopping:false,error:null,threadId:'h',generation:1,revision:1,ownerTurn:null,messages:[]};
 const calls=[],api={conversationStatus:s=>calls.push(['baseline',s.messages.length]),configureUserRequestPreviewV2:()=>{calls.push(['configure']);return true;},revokePresentation:()=>calls.push(['generic_revoke']),revokeOwnedPresentation:r=>calls.push(['revoke',r])};
 const state={channel:{token:'d'},output:{thread:'h'},conversation:{snapshot:()=>structuredClone(snapshot)}};
 const page={evaluate:(fn,arg)=>Promise.resolve(runInNewContext(`(${fn.toString()})(arg)`,{window:{fischLive:api},arg,performance,Date}))};
 const bridge=new UserRequestPresentationBridgeV2({state,page,provider:author,paragraphSources:true});
 return {bridge,snapshot,calls,api};
}
it('configures after exact initial baseline and dispatches accepted user once across assistant growth',async()=>{
 const f=fixture();await f.bridge.previewReady;expect(f.calls.map(x=>x[0])).toEqual(['baseline','configure']);
 const jobs=[];f.bridge.dispatch=job=>{jobs.push(job);f.bridge.selected=job;};
 f.snapshot.messages.push({id:'u',turn:'t',role:'user',status:'completed',text:'Please show a shape.'});f.snapshot.ownerTurn='t';f.snapshot.revision++;
 f.bridge.observeUserRequestV2();const deadline=jobs[0].monotonicDeadline;
 f.snapshot.messages.push({id:'a',turn:'t',role:'assistant',status:'streaming',text:'I am explaining something.'});f.snapshot.revision++;
 f.bridge.observeUserRequestV2();expect(jobs).toHaveLength(1);expect(f.bridge.valid(jobs[0])).toBe(true);expect(jobs[0].monotonicDeadline).toBe(deadline);
 f.bridge.invalidate();f.bridge.observeUserRequestV2();expect(jobs).toHaveLength(1);await f.bridge.close();
});
it('handoff forwards the exact prepared scope/capture and does not request a fresh ticket',async()=>{
 const f=fixture();await f.bridge.previewReady;f.bridge.valid=()=>true;
 const scope={epoch:'e',sceneRevision:1},capture={sourceVersion:1,receipt:{epoch:'e',sceneRevision:1,seq:2}};
 const job={...timing(),scene:{scope},userCapture:capture,controller:new AbortController(),checkpoint:{checkpointRevision:2}};
 f.api.handoffUserRequestV2=value=>{f.calls.push(['handoff',value]);return {status:'accepted',epoch:'e',sceneRevision:2,seq:3};};
 await f.bridge.apply(job,scene);const sent=f.calls.find(x=>x[0]==='handoff')[1];expect(sent.scope).toEqual(scope);expect(sent.capture).toEqual(capture);expect(sent).not.toHaveProperty('ticket');expect(job.admitted).toBe(true);
 await f.bridge.close();
});
it('retain uses atomic handoff; unknown response faults and attempts exact captured cleanup',async()=>{
 const f=fixture();await f.bridge.previewReady;f.bridge.valid=()=>true;
 const capture={sourceVersion:1,receipt:{epoch:'e',sceneRevision:1,seq:2}};
 const job=()=>({...timing(),scene:{scope:{}},userCapture:capture,controller:new AbortController(),checkpoint:{checkpointRevision:2}});
 f.api.handoffUserRequestV2=value=>{expect(value.retain).toBe(true);return {status:'retained'};};await f.bridge.apply(job(),retain);
 f.api.handoffUserRequestV2=()=>undefined;await expect(f.bridge.apply(job(),retain)).rejects.toThrow('presentation_handoff_unknown');expect(f.bridge.browserFault).toBe(true);expect(f.calls).toContainEqual(['revoke',capture.receipt]);await f.bridge.close();
});
it('invalid V2 protocol and model/custom provider conflict fail before browser setup',()=>{
 expect(()=>new UserRequestPresentationBridgeV2({protocol:'compact'})).toThrow('presentation_user_options');
 expect(()=>new UserRequestPresentationBridgeV2({provider:{},visualModel:'m',visualEffort:'low'})).toThrow('presentation_model_provider_conflict');
});

it('setup false/rejection clears failed visual provider while preserving primary failure',async()=>{
 for(const rejects of [false,true]){
  let closed=0;const primary=Error('setup_rejected');const state={presentation:{previewReady:rejects?Promise.reject(primary):Promise.resolve(false),close:async()=>{closed++;throw Error('cleanup_secondary');}}};
  await expect(configureUserRequestPresentationV2(state)).rejects.toThrow(rejects?'setup_rejected':'presentation_user_setup');expect(closed).toBe(1);expect(state.presentation).toBe(null);
 }
 const normal={presentation:{close:()=>{throw Error('default must not close');}}};await configureUserRequestPresentationV2(normal);expect(normal.presentation).toBeTruthy();
});

const until=async predicate=>{for(let n=0;n<100&&!predicate();n++)await new Promise(r=>setTimeout(r,5));expect(predicate()).toBe(true);};
it('inherited observe/pending/drain preserves user owner until validated assistant handoff',async()=>{
 const started=[],releases=[];let f,owned=null;
 const author={generate:async(ex,_signal,_scene,stream)=>{started.push({ex,stream});if(ex.sourceRole==='user_request')stream.onRecord(scene);await new Promise(resolve=>releases.push(resolve));},close(){for(const resolve of releases)resolve();}};
 f=fixture(author);await f.bridge.previewReady;
 f.api.userRequestSourceV2=()=>({sourceVersion:1,remainingTtlMs:9000});
 f.api.presentationPreparationTicket=()=>({intentVersion:0,preparationVersion:1});
 f.api.preparePresentation=identity=>({scope:{...identity,epoch:'e',sceneRevision:owned?.sceneRevision??0,intentVersion:0,admissionVersion:1},partIds:[]});
 f.api.applyPreparedPresentation=()=>{owned={epoch:'e',sceneRevision:1,seq:1};return {status:'accepted',...owned};};
 f.api.captureUserRequestV2=()=>({sourceVersion:1,receipt:owned&&{...owned}});
 f.api.handoffUserRequestV2=value=>{f.calls.push(['handoff',value]);owned=null;return {status:'retained'};};
 try{
  f.snapshot.ownerTurn='t';f.snapshot.revision++;f.snapshot.messages.push({id:'u',turn:'t',role:'user',status:'completed',text:'Please show an abstract shape.'});
  f.bridge.observeUserRequestV2();await until(()=>owned!==null);const original=f.bridge.selected.expiresAt;
  const text='This is a complete public explanation with enough exact text to qualify as one paragraph without removing any condition.';
  f.snapshot.messages.push({id:'a',turn:'t',role:'assistant',status:'streaming',text});f.snapshot.revision++;
  f.bridge.observe({method:'item/started',params:{threadId:'h',turnId:'t',item:{id:'a',type:'agentMessage',phase:'final_answer'}}});
  f.snapshot.messages[1].text+='\n\n';f.snapshot.revision++;
  f.bridge.observe({method:'item/agentMessage/delta',params:{threadId:'h',turnId:'t',itemId:'a',delta:'\n\n'}});
  expect(f.bridge.pending.messageId).toBe('a');expect(owned).not.toBe(null);expect(f.bridge.selected.expiresAt).toBe(original);
  releases[0]();await until(()=>started.length===2);expect(owned).not.toBe(null);expect(f.calls.some(x=>['revoke','generic_revoke'].includes(x[0]))).toBe(false);
  started[1].stream.onRecord(retain);await until(()=>f.calls.some(x=>x[0]==='handoff'));expect(owned).toBe(null);expect(started[1].ex.sourceRole).toBeUndefined();
 }finally{for(const resolve of releases)resolve();await f.bridge.close();}
});

it('user-mode serializer preserves conditional Unicode source without assistant aliases or extra input',async()=>{
 Rpc.answer=JSON.stringify(retain);
 const target='Only if the condition holds, depict the imagined shape; otherwise keep the canvas unchanged. \u0111\uD83D\uDE00';
 const input={...exchange,userText:target,target,publicContext:'[user] '+target,assistantText:'Not the source',privateReasoning:'must not transmit'};
 expect(await authored({userRequestV2:true},input)).toEqual([retain]);
 const sent=JSON.parse(Rpc.calls.find(c=>c.method==='turn/start').params.input[0].text);
 expect(Object.keys(sent).sort()).toEqual(['sourceRole','userRequest','target','publicContext','scene'].sort());
 expect(sent.userRequest).toBe(target);expect(sent.target).toBe(target);expect(sent.publicContext).toBe(input.publicContext);
 expect([...sent.target].slice(-2).map(c=>c.codePointAt(0))).toEqual([0x111,0x1f600]);expect(JSON.parse(JSON.stringify(sent))).toEqual(sent);
});
