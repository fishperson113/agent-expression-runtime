import {describe,it,expect,vi,afterEach} from 'vitest';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SelectorClient,bootstrapSelector} from '../integrations/selector-client.mjs';
import {encodeSelector,selectorText,selectorDecision,sourceHash,createSelectorEngine,
 serveSelectorWorker,readSelectorBundle,selectorFileDigest,PROFILE} from '../integrations/selector-runtime.mjs';

const input={publicContext:'Prior public context.',target:'Current public text.'};
class Child extends EventEmitter {
 connected=true; sent=[]; kills=0;
 send(value,callback){this.sent.push(structuredClone(value));callback?.();}
 kill(){this.kills++;queueMicrotask(()=>this.emit('exit',null,'SIGKILL'));return true;}
 disconnect(){this.connected=false;this.emit('disconnect');}
}
function started(options={}) {
 const child=new Child(),client=new SelectorClient(child,{},options);
 child.emit('message',{type:'ready',profile:PROFILE});
 return {child,client};
}
const resultFor=job=>({type:'result',id:job.id,result:{probabilities:[.7,.1,.2],selected:['a01'],
 tokens:8,sourceHash:sourceHash(selectorText(job.input)),timing:{tokenizeMs:1,inferenceAndHeadMs:2,totalMs:3}}});
const pause=()=>new Promise(resolve=>queueMicrotask(resolve));
afterEach(()=>vi.useRealTimers());

describe('selector isolated data contract',()=>{
 it('rejects unknown input, oversized bytes and token overflow without truncation',()=>{
  expect(()=>selectorText({...input,role:'assistant'})).toThrow('selector_input');
  expect(()=>selectorText({publicContext:'x'.repeat(32768),target:'x'})).toThrow('selector_input_size');
  const tokenizer={encode:vi.fn(()=>({ids:[0,...Array(127).fill(7),2]}))};
  expect(()=>encodeSelector(tokenizer,input)).toThrow('selector_too_long');
  expect(tokenizer.encode).toHaveBeenCalledWith(selectorText(input),{add_special_tokens:true});
 });
 it('retains exact source and checks special IDs, vocabulary and finite head coefficients',()=>{
  const tokenizer={encode:()=>({ids:[0,8,2]})};
  expect(encodeSelector(tokenizer,input)).toEqual({ids:[0,8,2],mask:[1,1,1],text:selectorText(input)});
  expect(()=>encodeSelector({encode:()=>({ids:[0,250037,2]})},input)).toThrow('selector_tokens');
  const head={labelOrder:['a01','a02','a03'],thresholds:[.5,.6,.5],coefficients:Array.from({length:3},()=>Array(384).fill(0)),intercepts:[0,0,0]};
  expect(selectorDecision(head,Array(384).fill(0))).toEqual({probabilities:[.5,.5,.5],selected:['a01','a03']});
  head.coefficients[0][0]=Infinity;
  expect(()=>selectorDecision(head,Array(384).fill(0))).toThrow('selector_head');
 });
 it('refuses an unpinned data manifest before native loading',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'selector-manifest-'));
  try {
   const file=path.join(root,'manifest.json');
   await fs.writeFile(file,JSON.stringify({schemaVersion:1,profile:PROFILE,files:{},worker:'malicious.js'}));
   await expect(readSelectorBundle(file)).rejects.toThrow('selector_bundle_invalid');
  } finally {await fs.rm(root,{recursive:true,force:true});}
 });
 it('bounds inference before run, keeps embeddings internal and releases exactly once',async()=>{
  const session={run:vi.fn(async()=>({sentence_embedding:{type:'float32',dims:[1,384],data:new Float32Array(384)}})),release:vi.fn()};
  let ids=[0,...Array(127).fill(7),2];
  const head={labelOrder:['a01','a02','a03'],thresholds:[.5,.6,.5],coefficients:Array.from({length:3},()=>Array(384).fill(0)),intercepts:[0,0,0]};
  const engine=createSelectorEngine({session,ort:{Tensor:class{}},tokenizer:{encode:()=>({ids})},head});
  await expect(engine.score(input)).rejects.toThrow('selector_too_long');expect(session.run).not.toHaveBeenCalled();
  ids=[0,9,2];const value=await engine.score(input);
  expect(value).not.toHaveProperty('embedding');expect(value).not.toHaveProperty('text');
  expect(value.sourceHash).toBe(sourceHash(selectorText(input)));
  await engine.close();await engine.close();expect(session.release).toHaveBeenCalledTimes(1);
 });
});

describe('selector client bounded lifecycle',()=>{
 it('singleflights and replaces only the latest pending request',async()=>{
  const {child,client}=started();
  const first=client.score(input),second=client.score({...input,target:'two'}).catch(e=>e.message);
  const third=client.score({...input,target:'three'});
  expect(await second).toBe('selector_superseded');expect(child.sent).toHaveLength(1);
  child.emit('message',resultFor(child.sent[0]));expect((await first).selected).toEqual(['a01']);
  expect(child.sent).toHaveLength(2);expect(child.sent[1].input.target).toBe('three');
  child.emit('message',resultFor(child.sent[1]));await third;
  const closed=client.close();child.emit('exit',0);await closed;
 });
 it('aborted active request rejects promptly but retains transport until its reply',async()=>{
  const {child,client}=started(),abort=new AbortController();
  const first=client.score(input,{signal:abort.signal}).catch(e=>e.message);abort.abort();
  expect(await first).toBe('selector_aborted');
  const next=client.score({...input,target:'next'});
  expect(child.sent.filter(x=>x.type==='score')).toHaveLength(1);
  child.emit('message',resultFor(child.sent[0]));
  const scores=child.sent.filter(x=>x.type==='score');expect(scores).toHaveLength(2);
  child.emit('message',resultFor(scores[1]));await next;
  const done=client.close();child.emit('exit',0);await done;
 });
 it('aborted pending request is never dispatched',async()=>{
  const {child,client}=started(),abort=new AbortController();
  const first=client.score(input),next=client.score({...input,target:'next'},{signal:abort.signal}).catch(e=>e.message);
  abort.abort();expect(await next).toBe('selector_aborted');
  child.emit('message',resultFor(child.sent[0]));await first;
  expect(child.sent.filter(x=>x.type==='score')).toHaveLength(1);
  const done=client.close();child.emit('exit',0);await done;
 });
 it('timeout kills the worker and pending job rather than overlapping inference',async()=>{
  vi.useFakeTimers();const {child,client}=started({requestMs:20});
  const first=client.score(input).catch(e=>e.message),next=client.score({...input,target:'next'}).catch(e=>e.message);
  await vi.advanceTimersByTimeAsync(21);
  expect(await first).toBe('selector_request_timeout');expect(await next).toBe('selector_request_timeout');
  expect(child.kills).toBe(1);expect(child.sent.filter(x=>x.type==='score')).toHaveLength(1);
  child.emit('message',resultFor(child.sent[0]));expect(child.sent.filter(x=>x.type==='score')).toHaveLength(1);
  await client.close();
 });
 it('fails closed on malformed result or source mismatch',async()=>{
  for(const change of [r=>r.result.sourceHash='0'.repeat(64),r=>r.result.embedding=[1],r=>r.result.selected=['a02']]){
   const {child,client}=started(),promise=client.score(input).catch(e=>e.message);
   const response=resultFor(child.sent[0]);change(response);child.emit('message',response);
   expect(await promise).toBe('selector_protocol');expect(child.kills).toBe(1);await pause();await client.close();
  }
 });
 it('close clears pending and waits for active cancellation before graceful exit',async()=>{
  const {child,client}=started();
  const first=client.score(input).catch(e=>e.message),next=client.score({...input,target:'next'}).catch(e=>e.message);
  const closed=client.close();
  expect(await first).toBe('selector_closed');expect(await next).toBe('selector_closed');
  child.emit('message',{type:'cancelled',id:child.sent[0].id});
  expect(child.sent.at(-1)).toEqual({type:'close'});
  child.emit('message',{type:'closed'});child.emit('exit',0);await closed;
  expect(child.sent.filter(x=>x.type==='score')).toHaveLength(1);
 });
 it('close is bounded when worker never replies',async()=>{
  vi.useFakeTimers();const {child,client}=started({closeMs:20});
  const active=client.score(input).catch(e=>e.message),closed=client.close();
  await vi.advanceTimersByTimeAsync(21);await closed;
  expect(await active).toBe('selector_closed');expect(child.kills).toBe(1);
 });
 it('startup errors and disconnect settle callers without leaked raw diagnostic text',async()=>{
  const child=new Child(),client=new SelectorClient(child,{});
  child.emit('error',Error('SECRET PATH'));
  await expect(client.ready).rejects.toThrow('selector_process');await pause();await client.close();
  const live=started(),pending=live.client.score(input).catch(e=>e.message);
  live.child.emit('disconnect');expect(await pending).toBe('selector_disconnect');await pause();await live.client.close();
 });
});

describe('selector internal worker',()=>{
 it('holds native operation across cancel/disconnect then releases without result text',async()=>{
  let resolve;const engine={score:vi.fn(()=>new Promise(r=>{resolve=r;})),close:vi.fn(async()=>{})};
  const port=new Child();serveSelectorWorker(engine,port);
  port.emit('message',{type:'score',id:'one',input});await pause();
  port.emit('message',{type:'cancel',id:'one'});port.emit('disconnect');
  expect(engine.close).not.toHaveBeenCalled();
  resolve({selected:[],probabilities:[0,0,0]});await pause();await pause();
  expect(engine.close).toHaveBeenCalledTimes(1);
  expect(port.sent.filter(x=>x.type==='result')).toHaveLength(0);
 });
 it('sanitizes inference errors',async()=>{
  const engine={score:vi.fn(async()=>{throw Error('private source text');}),close:vi.fn(async()=>{})};
  const port=new Child();serveSelectorWorker(engine,port);
  port.emit('message',{type:'score',id:'one',input});await pause();
  expect(port.sent.at(-1)).toEqual({type:'error',id:'one',code:'selector_inference'});
  port.emit('message',{type:'close'});await pause();
 });
});

describe('selector abortable bootstrap IO',()=>{
 it('already aborted bootstrap never forks or reads a missing bundle',async()=>{
  const abort=new AbortController();abort.abort();const fork=vi.fn();
  await expect(bootstrapSelector(path.join(os.tmpdir(),'missing-selector-manifest.json'),{signal:abort.signal,fork}))
   .rejects.toThrow('selector_unavailable');
  expect(fork).not.toHaveBeenCalled();
 });
 it('rejects network and device paths without forking',async()=>{
  const fork=vi.fn();
  for(const file of ['//server/share/manifest.json','\\\\server\\share\\manifest.json','\\\\?\\C:\\manifest.json'])
   await expect(bootstrapSelector(file,{fork})).rejects.toThrow('selector_unavailable');
  expect(fork).not.toHaveBeenCalled();
 });
 it('aborting a file hash destroys and closes the real stream before rejection settles',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'selector-hash-'));
  const file=path.join(root,'synthetic.bin');await fs.writeFile(file,Buffer.alloc(1024*1024));
  const actual=nodeFs.createReadStream;let stream;
  const spy=vi.spyOn(nodeFs,'createReadStream').mockImplementation((...args)=>{stream=actual(...args);return stream;});
  try {
   const abort=new AbortController(),pending=selectorFileDigest(file,abort.signal);
   abort.abort();await expect(pending).rejects.toThrow();
   expect(stream.destroyed).toBe(true);expect(stream.closed).toBe(true);
  } finally {spy.mockRestore();await fs.rm(root,{recursive:true,force:true});}
 });
});