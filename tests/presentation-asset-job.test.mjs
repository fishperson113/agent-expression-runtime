import {expect,it} from 'vitest';
import {bindAssetJob} from '../integrations/presentation-asset-job.mjs';
import {NativePresentationProvider} from '../integrations/presentation-provider.mjs';
const exchange={userText:'u',target:'t',publicContext:'c',assistantText:'a'};
const parseRecord=()=>({mode:'retain',payload:null});
const library=createJob=>({policy:'fixed',parseRecord,createJob});
it('captures own public strings and pairs isolated immutable input/parser per job',()=>{
 let captured;const original={items:[{text:'first'}]};const lib=library(e=>{captured=e;return {input:original,parseRecord(){return this.input.items[0].text;}};});
 const first=bindAssetJob(lib,{...exchange,privateReasoning:'secret'});original.items[0].text='second';const second=bindAssetJob(lib,exchange);
 expect(first.parseRecord('')).toBe('first');expect(second.parseRecord('')).toBe('second');expect(captured).toEqual(exchange);expect(Object.isFrozen(captured)).toBe(true);expect(Object.isFrozen(first.input.items[0])).toBe(true);
});
it('legacy factory absence returns null',()=>expect(bindAssetJob({parseRecord,policy:'p'},null)).toBeNull());
it('does not invoke getters or accept inherited required exchange fields',()=>{
 let calls=0;const lib=library(()=>{calls++;return {input:{},parseRecord};});
 expect(()=>bindAssetJob(lib,Object.create(exchange))).toThrow();
 expect(()=>bindAssetJob(lib,{...exchange,get target(){throw Error('getter');}})).toThrow('presentation_asset_job_invalid');expect(calls).toBe(0);
});
it('optional assistantText stays absent and is validated when supplied',()=>{
 let captured;const lib=library(e=>{captured=e;return {input:{},parseRecord};});bindAssetJob(lib,{userText:'u',target:'t',publicContext:'c'});expect(captured).not.toHaveProperty('assistantText');expect(()=>bindAssetJob(lib,{...exchange,assistantText:undefined})).toThrow();
});
it('rejects malformed, asynchronous and getter-shaped jobs without invoking accessors',()=>{
 for(const job of [null,Promise.resolve({}),{then(){}},{input:{},parseRecord:0},{get input(){throw Error('getter');},parseRecord},{input:{},get parseRecord(){throw Error('getter');}}])
 expect(()=>bindAssetJob(library(()=>job),exchange)).toThrow('presentation_asset_job_invalid');
});
it('rejects non JSON values, exotic objects, cycles, sparse arrays and excessive size',()=>{
 const cycle={};cycle.self=cycle;
 for(const input of [{v:NaN},{v:Infinity},{v:undefined},{v:()=>{}},{v:Symbol()},{v:1n},{v:new Date()},cycle,{v:Array(2)},{v:'x'.repeat(65537)},{get v(){throw Error('getter');}}])expect(()=>bindAssetJob(library(()=>({input,parseRecord})),exchange)).toThrow('presentation_asset_job_invalid');
});
let allocated=0;
class Rpc {
 constructor(_c,_a,_cwd,notify){allocated++;this.notify=notify;this.settled=Promise.resolve();}
 send(){}close(){}
 async request(method,p){
 if(method==='config/read')return {config:{features:Object.fromEntries(['shell_tool','apps','plugins','multi_agent','computer_use','browser_use','image_generation','view_image'].map(k=>[k,false])),mcp_servers:{}}};
 if(method==='thread/start')return {thread:{id:'v'}};
 if(method==='mcpServerStatus/list')return {data:[]};
 if(method==='turn/start'){Rpc.data=JSON.parse(p.input[0].text);queueMicrotask(()=>{this.notify('item/completed',{threadId:'v',item:{id:'i',type:'agentMessage',phase:'final_answer',text:'{"mode":"retain","payload":null}'}});this.notify('turn/completed',{threadId:'v',turn:{id:'t',status:'completed'}});});return {turn:{id:'t'}};}
 return {};
 }
}
const make=assetLibrary=>new NativePresentationProvider({host:{command:'fixture',args:[]},runtime:{cwd:'fixture',env:{}},Rpc,compact:true,assetLibrary});
const stream={isCurrent:()=>true,onRecord(){}};
it('factory throws or invalid input allocates no RPC and remains closable',async()=>{
 for(const create of [()=>{throw Error('factory_failed');},()=>({input:{v:NaN},parseRecord}),()=>Promise.resolve({})]){const p=make(library(create)),before=allocated;await expect(p.generate(exchange,new AbortController().signal,{},stream)).rejects.toThrow();expect(allocated).toBe(before);await p.close();}
});
it('factory input and parser are captured once before RPC, not substituted later',async()=>{
 let calls=0,parses=0;const data={only:'factory'};const p=make(library(()=>{calls++;return {input:data,parseRecord(text){parses++;expect(this.input.only).toBe('factory');return JSON.parse(text);}};}));
 await p.generate(exchange,new AbortController().signal,{},stream);expect(calls).toBe(1);expect(parses).toBe(1);expect(Rpc.data).toEqual(data);await p.close();
});
it('constructor rejects nonfunction factory and preserves unsupported mode guards',()=>{
 expect(()=>make(library(4))).toThrow('presentation_asset_options');
 expect(()=>new NativePresentationProvider({host:{},assetLibrary:library(()=>({}))})).toThrow('presentation_asset_options');
});
it.each(['abort','close'])('factory job cannot spawn after pending retirement and %s',async kind=>{
 const p=make(library(()=>({input:{},parseRecord})));const {PresentationTransport}=await import('../integrations/presentation-transport.mjs');p.transport=new PresentationTransport({Rpc});
 let finish;p.transport.retiring=new Promise(r=>finish=r);const controller=new AbortController(),before=allocated;
 const running=p.generate(exchange,controller.signal,{},stream);running.catch(()=>{});let closing;
 if(kind==='abort')controller.abort();else closing=p.close();finish();await expect(running).rejects.toThrow();expect(allocated).toBe(before);await (closing??p.close());
});
it('legacy library retains exact public request bytes without factory',async()=>{
 const p=make({policy:'fixed',parseRecord});const scene={partIds:['face']};await p.generate(exchange,new AbortController().signal,scene,stream);
 expect(JSON.stringify(Rpc.data)).toBe(JSON.stringify({userText:'u',assistantText:'a',scene,target:'t',publicContext:'c'}));await p.close();
});
it('enforces exact JSON UTF8 byte boundary and bounded depth/value count',()=>{
 const bind=input=>bindAssetJob(library(()=>({input,parseRecord})),exchange);
 expect(JSON.stringify(bind({v:'x'.repeat(65528)}).input)).toHaveLength(65536);
 expect(()=>bind({v:'x'.repeat(65529)})).toThrow();expect(()=>bind({v:'\u{1f600}'.repeat(16383)})).toThrow();
 let depth={};for(let i=0;i<32;i++)depth={v:depth};expect(()=>bind(depth)).not.toThrow();depth={v:depth};expect(()=>bind(depth)).toThrow();
 expect(()=>bind({v:Array(16382).fill(0)})).not.toThrow();expect(()=>bind({v:Array(16383).fill(0)})).toThrow();
});
