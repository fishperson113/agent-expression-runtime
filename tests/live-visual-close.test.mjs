import { it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
const f=vi.hoisted(()=>({}));
vi.mock('../integrations/presentation-streaming-bridge.mjs',()=>({
  presentationSourceOptions:()=>({}),LiveStreamingPresentationBridge:class {constructor(){return f.presentation;}}
}));
vi.mock('../integrations/live-codex-transport.mjs',()=>({openCodexTransport:async()=>f.transport}));
vi.mock('../integrations/live-reactive-broker.mjs',()=>({LiveReactiveBroker:class {constructor(){return f.broker;}}}));
vi.mock('../integrations/live-conversation.mjs',()=>({LiveConversation:class {constructor(){return f.conversation;}},bindLiveConversation:async()=>{if(f.bindError)throw f.bindError;return f.unbind;}}));
vi.mock('../integrations/live-output.mjs',()=>({LiveOutput:class {constructor(){this.thread='t';}}}));
vi.mock('../integrations/fisch-codex-runtime.mjs',()=>({fischCodexRuntime:()=>({cwd:process.cwd(),env:{}})}));
vi.mock('../scripts/live-codex.mjs',()=>({liveCodexArguments:()=>['-c','test']}));
vi.mock('../scripts/start-session.mjs',()=>({codexCommand:async()=>({command:'fake',args:[]}),stopChild:()=>f.stopChild()}));
import { runTerminalCodex, presentationCall } from '../integrations/live-terminal.mjs';
import { runPanelCodex } from '../integrations/live-panel.mjs';

beforeEach(()=>{
  f.done=Promise.withResolvers();f.started=Promise.withResolvers();f.bindError=null;
  f.presentation={close:vi.fn(()=>f.done.promise),observe:vi.fn(()=>Promise.reject(Error('event')))};
  f.transport={url:'local',token:'test',close:vi.fn(async()=>{})};
  f.broker={closed:false,evaluate:vi.fn(async()=>true),close:vi.fn(),browserUnavailable:false};
  f.conversation={close:vi.fn(),snapshot:()=>({}),startupFailed:vi.fn()};
  f.unbind=vi.fn();f.stopChild=vi.fn(async()=>{});
});
function setup(){const controller=new AbortController();const frame={url:()=> 'local'};
 const live={base:'local',token:'test',page:{url:frame.url,mainFrame:()=>frame,exposeBinding:async()=>{},isClosed:()=>false}};
 return {controller,options:{live,cwd:process.cwd(),signal:controller.signal,host:{command:'fake',args:[]},reactiveProvider:null}};
}
it.each(['terminal','panel'])('%s normal abort waits deferred visual close while other owners close',async mode=>{
  const {controller,options}=setup();let child;const client={threadId:'t',close:vi.fn(async()=>{})};
  const running=mode==='terminal'?runTerminalCodex({...options,spawnClient:()=>{child=new EventEmitter();f.started.resolve();return child;}})
    :runPanelCodex({...options,clientFactory:async()=>{f.started.resolve();return client;}});
  let settled=false;running.then(()=>settled=true,()=>settled=true);await f.started.promise;await Promise.resolve();controller.abort();child?.emit('exit',0);
  await vi.waitFor(()=>expect(f.transport.close).toHaveBeenCalled());expect(settled).toBe(false);
  expect(f.presentation.close).toHaveBeenCalledTimes(1);f.done.resolve();expect(await running).toBe(130);
  expect(f.presentation.close).toHaveBeenCalledTimes(1);expect(f.unbind).toHaveBeenCalled();
});
it.each(['terminal','panel'])('%s startup failure still joins visual close and preserves primary error',async mode=>{
  const {options}=setup(),primary=Error('binding_failed');f.bindError=primary;
  const running=mode==='terminal'?runTerminalCodex(options):runPanelCodex(options);running.catch(()=>{});
  await vi.waitFor(()=>expect(f.presentation.close).toHaveBeenCalledTimes(1));
  expect(f.transport.close).toHaveBeenCalled();f.done.reject(Error('visual_close_failed'));
  await expect(running).rejects.toBe(primary);expect(f.presentation.close).toHaveBeenCalledTimes(1);
});
it('ordinary event delivery remains nonblocking and rejection-contained',async()=>{
  expect(presentationCall({presentation:f.presentation},'observe',{})).toBeUndefined();
  await new Promise(r=>setImmediate(r));expect(f.presentation.observe).toHaveBeenCalledTimes(1);
});
