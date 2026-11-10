import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
let root, runLiveSession, openLive, runTerminalCodex;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test,timeout=10000){const started=performance.now();while(performance.now()-started<timeout){const value=await test();if(value)return value;await sleep(20);}throw Error('public_probe_timeout');}
export async function waitForHostReady(ready, running, timeoutMs = 60000) {
 let timer;
 try {
  return await Promise.race([ready,
   running.then(() => { throw Error('public_host_exited_before_ready'); }, () => { throw Error('public_host_setup_failed'); }),
   new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('public_ready_timeout')), timeoutMs); })]);
 } finally { clearTimeout(timer); }
}
export async function closeProbeOwned(closers, preserveFailure = false) {
 const results = await Promise.allSettled(closers.map(close => Promise.resolve().then(close)));
 if (!preserveFailure && results.some(result => result.status === 'rejected')) throw Error('public_probe_cleanup_failed');
}
async function launch(expression=false){
 const abort=new AbortController(),ready=Promise.withResolvers(),results=[],destinations=new Set();let live,child;
 const running=runLiveSession({headless:true,assets:false,signal:abort.signal,
  open:async options=>{const opened=await openLive({...options,production:false,synthetic:true});
   opened.page.on('request',request=>destinations.add(new URL(request.url()).hostname));
   await opened.page.evaluate(()=>{const api=window.fischLive,original=api.conversationStatus;api.conversationStatus=value=>{window.publicProbeConversation=structuredClone(value);original(value);};});return opened;},
  runHost:options=>{live=options.live;return runTerminalCodex({...options,reactiveProvider:null,
   host:{command:process.execPath,args:[root+'/tests/fixtures/'+(expression?'playground-agent.mjs':'conversation-host-agent.mjs')]},
   spawnClient:(command,args,settings)=>{child=spawn(command,args,{...settings,stdio:['pipe','pipe','pipe']});child.stderr.resume();let buffer='';
    child.stdout.on('data',bytes=>{buffer+=bytes;if(buffer.length>1048576)throw Error('public_fixture_bound');let end;while((end=buffer.indexOf('\n'))>=0){const row=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(row.type==='ready')ready.resolve(row);if(row.type==='result'){results.push(row);if(results.length>16)results.shift();}}});return child;}});}});
 void running.catch(()=>{});const close=preserveFailure=>closeProbeOwned([()=>abort.abort(),()=>child?.stdin.end(),()=>running],preserveFailure);
 try{const metadata=await waitForHostReady(ready.promise, running);
  await until(()=>live.page.evaluate(()=>window.publicProbeConversation?.canSend));return{live,results,metadata,destinations,close};
 }catch(error){await close(true);throw error;}
}
function upstream(route, component){
 const originals=new Map(),history=[],contexts=[],interrupts=[],generations=[],cancelled=[];let serial=0;
 const snapshot=()=>route.live.page.evaluate(()=>window.publicProbeConversation);
 const runtime=component.createChatOrchestratorRuntime({session:{getSessionMessages:()=>history,getSessionGeneration:()=>1,
  commitUserMessage:async(id,message)=>{history.push(structuredClone(message));return{status:'inserted',messageId:message.id};},commitAssistantMessage:async(id,message)=>history.push(structuredClone(message))},
  context:{ingest(){},snapshot:()=>({})},foregroundStream:{patch(){},reset(){}},getActiveSessionId:()=> 'public-session',getActiveProvider:()=> 'existing-native-binding',createId:()=>`public-${++serial}`,
  llm:{stream:async(model,provider,conversation,options)=>{
   contexts.push(structuredClone(conversation));const current=await snapshot(),generation=current.generation;generations.push(generation);
   const text=originals.get(options.requestCorrelation.turnId);if(typeof text!=='string')throw Error('public_intent_correlation_missing');
   const cancel=()=>{const work=route.live.page.evaluate(value=>window.fischLiveConversation(value),{action:'cancel',generation});interrupts.push(work);void work.catch(()=>{});};
   options.abortSignal.addEventListener('abort',cancel,{once:true});
   try{await route.live.page.evaluate(value=>window.fischLiveConversation(value),{action:'send',generation,text});
    let forwarded='';await until(async()=>{const state=await snapshot();if(state.generation!==generation)throw Error('public_generation_changed');if(state.error)throw Error(state.error);
     const message=state.messages.findLast(item=>item.role==='assistant');if(message&&message.text!==forwarded){await options.onStreamEvent({type:'text-delta',text:message.text.slice(forwarded.length)});forwarded=message.text;}
     if(state.messages.some(item=>item.status==='interrupted'))cancelled.push(true);return state.revision>current.revision&&state.canSend&&!state.pending&&!state.canCancel;},15000);
    await options.onStreamEvent({type:'finish'});
   }finally{options.abortSignal.removeEventListener('abort',cancel);}
  }}});
 return{runtime,contexts,generations,cancelled,snapshot,settleInterrupts:()=>Promise.all(interrupts),send:(text,id)=>{originals.set(id,text);return runtime.submit(text,{model:'existing-native-binding',chatProvider:{generation:model=>({protocol:'chat-completions',config:{model,baseURL:'https://invalid.example/'}})},messageId:id},'public-session');}};
}
async function conversationProof(component) {
 const route=await launch(false);let failed=false;
 try {
  const adapter=upstream(route,component),first=adapter.send('Public amber-loop first intent','first');
  await until(async()=>(await adapter.snapshot()).canCancel);
  adapter.runtime.cancelTurn({sessionId:'public-session',turnId:'first'});await first.done;await adapter.settleInterrupts();
  await until(async()=>!(await adapter.snapshot()).canCancel);
  const second=adapter.send('Public amber-loop second intent','second');await until(async()=>(await adapter.snapshot()).canCancel);
  assert(JSON.stringify(adapter.contexts[1]).includes('Public amber-loop first intent'));
  adapter.runtime.cancelTurn({sessionId:'public-session',turnId:'second'});await second.done;await adapter.settleInterrupts();
  assert.equal(await route.live.page.evaluate(()=>window.fischLive.metrics().cameraActive),false);
  return {binding:'fischLiveConversation',sends:2,cancels:2,upstreamTwoTurnContext:true,nativeSceneContextDelivery:'not_run'};
 }catch(error){failed=true;throw error;}finally{await route.close(failed);}
}
async function expressionProof(component) {
 const route=await launch(true);let failed=false;
 try {
  assert(route.metadata.tools.includes('express'));const adapter=upstream(route,component);
  await adapter.send(JSON.stringify({operation:'express'}),'expression').done;
  await until(()=>route.results.some(item=>item.command==='express'&&item.value.status==='accepted'));
  const metrics=await until(async()=>{
   const value=await route.live.page.evaluate(()=>window.fischLive.metrics()),events=value.diagnostics.events;
   const applied=events.find(event=>event.origin==='native'&&event.phase==='applied'&&event.epoch!=='local');if(!applied)return;
   const same=events.filter(event=>event.origin==='native'&&event.epoch===applied.epoch&&event.seq===applied.seq);
   return ['applied','completed','frame_submitted','frame_changed_proxy'].every(phase=>same.some(event=>event.phase===phase))
    ?{scene:value.scene,camera:value.cameraActive,seq:applied.seq,epoch:applied.epoch,phases:same.map(event=>event.phase)}:undefined;
  });
  assert.equal(metrics.scene,'wall');assert.equal(metrics.camera,false);
  return {metrics,observedBrowserDestinations:[...route.destinations]};
 }catch(error){failed=true;throw error;}finally{await route.close(failed);}
}
export async function probeBrowser(component, suppliedRoot) {
 root=suppliedRoot??fileURLToPath(new URL('../../',import.meta.url));
 ({runLiveSession}=await import(pathToFileURL(root+'/scripts/live-session.mjs')));
 ({openLive}=await import(pathToFileURL(root+'/integrations/live-launch.mjs')));
 ({runTerminalCodex}=await import(pathToFileURL(root+'/integrations/live-terminal.mjs')));
 const started=performance.now();
 return {hostSource:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  models:'scripted app-server only',browser:'headless synthetic; no native GPU claim',
  canonicalHost:await conversationProof(component),fisch:await expressionProof(component),
  automaticCancelSafety:'FAILED: delayed old actor can cancel newer same-generation Native owner; research only',
  elapsedMs:performance.now()-started};
}
