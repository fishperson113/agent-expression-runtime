import { expect, it } from 'vitest';
import { NativePresentationProvider, parsePresentation, presentationSchema, parseMiniPresentation } from '../integrations/presentation-provider.mjs';
const result = { reply: '', scenes: [{ holdMs: 1000, decision: { mode: 'retain', reasonCode: 'ordinary', payload: null } }] };
const features = Object.fromEntries(['shell_tool','apps','plugins','multi_agent','computer_use','browser_use','image_generation','view_image'].map(key => [key,false]));
class Rpc {
  static calls = []; static badCatalog = false; static attemptTool = false; static rejectTurn = false;
  constructor(_command,args,_cwd,notify) { this.notify=notify; this.args=args; this.settled=Promise.resolve(); Rpc.calls=[]; }
  send() {} close() {}
  async request(method, params) {
    Rpc.calls.push({method,params});
    if (method==='config/read') return {config:{features,mcp_servers:{}}};
    if (method==='thread/start') return {thread:{id:'visual-thread'}};
    if (method==='mcpServerStatus/list') return {data:Rpc.badCatalog?[{tools:{bad:{}}}]:[]};
    if (method==='turn/start') {
      if(Rpc.rejectTurn) throw Error('provider_quota_or_tier_rejected');
      queueMicrotask(()=>{
        this.notify('turn/started',{threadId:'visual-thread',turn:{id:'visual-turn'}});
        if(Rpc.attemptTool)this.notify('item/started',{threadId:'visual-thread',item:{type:'commandExecution'}});
        this.notify('item/completed',{threadId:'visual-thread',item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify(result)}});
        this.notify('turn/completed',{threadId:'visual-thread',turn:{id:'visual-turn',status:'completed'}});
      }); return {turn:{id:'visual-turn'}};
    }
    return {};
  }
}
const make=()=>new NativePresentationProvider({host:{command:'fixture',args:[]},runtime:{cwd:'fixture',env:{}},Rpc});
it('forbids textual replies and bounds scene plans',()=>{
 expect(parsePresentation(JSON.stringify(result))).toHaveLength(1);
 expect(()=>parsePresentation(JSON.stringify({...result,reply:'replacement answer'}))).toThrow();
 expect(()=>parsePresentation(JSON.stringify({...result,scenes:Array(5).fill(result.scenes[0])}))).toThrow();
 expect(()=>parsePresentation(JSON.stringify({...result,scenes:[{...result.scenes[0],holdMs:999999}]}))).toThrow();
});
it('uses an independent read-only no-tools thread with public data only',async()=>{
 const provider=make(); const exchange={userText:'flink la gi',assistantText:'Published answer',privateReasoning:'secret'};
 const scenes=await provider.generate(exchange,new AbortController().signal,{partIds:['face']}); expect(scenes).toHaveLength(1);
 const thread=Rpc.calls.find(c=>c.method==='thread/start').params;
 expect(thread).toMatchObject({ephemeral:true,serviceTier:'priority',sandbox:'read-only',approvalPolicy:'never',developerInstructions:''});
 const turn=Rpc.calls.find(c=>c.method==='turn/start').params;
 expect(turn.input[0].text).not.toContain('secret');expect(turn.threadId).toBe('visual-thread');provider.close();
});
it('rejects nonempty tool catalogs before model generation',async()=>{
 Rpc.badCatalog=true;const provider=make();try{await expect(provider.generate({userText:'a',assistantText:'b'},new AbortController().signal,{})).rejects.toThrow('presentation_catalog');
 expect(Rpc.calls.some(c=>c.method==='turn/start')).toBe(false);}finally{Rpc.badCatalog=false;provider.close();}
});
it('rejects attempted tool execution instead of accepting the accompanying answer',async()=>{
 Rpc.attemptTool=true;const provider=make();try{await expect(provider.generate({userText:'a',assistantText:'b'},new AbortController().signal,{})).rejects.toThrow('presentation_tool_forbidden');}
 finally{Rpc.attemptTool=false;provider.close();}
});


it('respects the standard tier opt-out without lowering model or reasoning',async()=>{
 const provider=new NativePresentationProvider({host:{command:'fixture',args:[]},runtime:{cwd:'fixture',env:{FISCH_CODEX_SERVICE_TIER:'default'}},Rpc});
 try{await provider.generate({userText:'a',assistantText:'b'},new AbortController().signal,{});
 const start=Rpc.calls.find(c=>c.method==='thread/start').params;expect(start.serviceTier).toBe('default');expect(start.model).toBeUndefined();
 const turn=Rpc.calls.find(c=>c.method==='turn/start').params;expect(turn.effort).toBeUndefined();}finally{provider.close();}
});
it('does not replay a rejected quota/tier request or silently select another tier',async()=>{
 Rpc.rejectTurn=true;const provider=make();try{await expect(provider.generate({userText:'a',assistantText:'b'},new AbortController().signal,{})).rejects.toThrow('provider_quota_or_tier_rejected');
 expect(Rpc.calls.filter(c=>c.method==='turn/start')).toHaveLength(1);expect(provider.active).toBeUndefined();}finally{Rpc.rejectTurn=false;provider.close();}
});

it('normalizes every reused object definition for Native structured output',()=>{
 const visit=value=>{if(!value||typeof value!=='object')return;
  if(value.type==='object'&&value.properties)expect([...(value.required??[])].sort()).toEqual(Object.keys(value.properties).sort());
  Object.values(value).forEach(visit);
 };visit(presentationSchema);
});

it('publishes a complete compact record before author terminal without changing MAIN or overriding model',async()=>{
 let finish, emitted=[];
 class StreamingRpc extends Rpc {
  async request(method,params){
   if(method!=='turn/start')return super.request(method,params);
   Rpc.calls.push({method,params});
   queueMicrotask(()=>{
    this.notify('turn/started',{threadId:'visual-thread',turn:{id:'visual-turn'}});
    this.notify('item/started',{threadId:'visual-thread',turnId:'visual-turn',item:{id:'v',type:'agentMessage',phase:'final_answer'}});
    this.notify('item/agentMessage/delta',{threadId:'visual-thread',turnId:'visual-turn',itemId:'v',delta:'{"mode":"retain","payload":null}'});
    finish=()=>{this.notify('item/completed',{threadId:'visual-thread',turnId:'visual-turn',item:{id:'v',type:'agentMessage',phase:'final_answer',text:'{"mode":"retain","payload":null}'}});this.notify('turn/completed',{threadId:'visual-thread',turn:{id:'visual-turn',status:'completed'}});};
   });return {turn:{id:'visual-turn'}};
  }
 }
 const provider=new NativePresentationProvider({host:{command:'fake',args:[]},runtime:{cwd:'fake',env:{}},Rpc:StreamingRpc});
 let done=false;const pending=provider.generate({userText:'a',assistantText:'public',target:'public'},new AbortController().signal,{}, {isCurrent:()=>true,onRecord:r=>emitted.push(r)}).then(()=>done=true);
 await new Promise(r=>setTimeout(r,5));expect(emitted).toEqual([{mode:'retain',payload:null}]);expect(done).toBe(false);
 expect(Rpc.calls.find(c=>c.method==='turn/start').params.outputSchema).toBeUndefined();finish();await pending;expect(emitted).toHaveLength(1);provider.close();
});

it('fails closed for a visual-only model configuration absent from the native catalog',async()=>{
 const provider=new NativePresentationProvider({host:{command:'fake',args:[]},runtime:{cwd:'fake',env:{}},Rpc,visualModel:'unknown',visualEffort:'low'});
 await expect(provider.generate({userText:'a',assistantText:'b'},new AbortController().signal,{}, {isCurrent:()=>true,onRecord(){}})).rejects.toThrow('presentation_model_unsupported');
 expect(Rpc.calls.some(c=>c.method==='turn/start')).toBe(false);provider.close();
});

it('uses compact grammar only in the independent visual request and expands its atomic record',async()=>{
 class CompactRpc extends Rpc {
  async request(method,params){if(method!=='turn/start')return super.request(method,params);Rpc.calls.push({method,params});queueMicrotask(()=>{
   this.notify('item/completed',{threadId:'visual-thread',item:{id:'compact',type:'agentMessage',phase:'final_answer',text:'{"base":"retain"}'}});
   this.notify('turn/completed',{threadId:'visual-thread',turn:{id:'visual-turn',status:'completed'}});
  });return {turn:{id:'visual-turn'}};}
 }
 const records=[];const provider=new NativePresentationProvider({host:{command:'fake',args:[]},runtime:{cwd:'fake',env:{}},Rpc:CompactRpc,compact:true});
 await provider.generate({userText:'hello',assistantText:'hello'},new AbortController().signal,{}, {isCurrent:()=>true,onRecord:r=>records.push(r)});
 expect(records).toEqual([{mode:'retain',payload:null}]);expect(Rpc.calls.find(c=>c.method==='thread/start').params.baseInstructions).toContain('SCREEN SPACE');expect(Rpc.calls.find(c=>c.method==='thread/start').params.baseInstructions).toContain('necessary conditions');provider.close();
});

it('mini-scene remains a complete generic compiler-valid record with bounded semantic roles',()=>{
 const part=['e','role',0,0,0,.2,.2,.2];
 const value={base:'replace',parts:[part],annotations:{labels:[{text:'role',x:.5,y:.5}]}};
 expect(parseMiniPresentation(JSON.stringify(value)).payload.parts).toHaveLength(1);
 expect(()=>parseMiniPresentation(JSON.stringify({...value,parts:[0,1,2,3].map(i=>[part[0],`role${i}`,...part.slice(2)])}))).toThrow('mini_record_schema');
 expect(()=>parseMiniPresentation(JSON.stringify({...value,annotations:{labels:Array(3).fill({text:'role',x:.5,y:.5})}}))).toThrow('mini_record_schema');
});

it('stops processing queued public deltas after first parser failure',async()=>{
 class BadStreamRpc extends Rpc {
  async request(method,params){if(method!=='turn/start')return super.request(method,params);queueMicrotask(()=>{
   this.notify('item/started',{threadId:'visual-thread',item:{id:'v',type:'agentMessage',phase:'final_answer'}});
   for(const delta of ['not json','more bad output','and more'])this.notify('item/agentMessage/delta',{threadId:'visual-thread',itemId:'v',delta});
   this.notify('turn/completed',{threadId:'visual-thread',turn:{status:'completed'}});
  });return {turn:{id:'visual-turn'}};}
 }
 const rejected=[];const provider=new NativePresentationProvider({host:{command:'fake',args:[]},runtime:{cwd:'fake',env:{}},Rpc:BadStreamRpc});
 await expect(provider.generate({userText:'x',assistantText:'y'},new AbortController().signal,{}, {isCurrent:()=>true,onRecord(){},onRejectedRecord:r=>rejected.push(r)})).rejects.toThrow();
 expect(rejected).toHaveLength(1);expect(rejected[0].text).toBe('not json');provider.close();
});

it('clears active ownership when transport construction throws',async()=>{
 class BrokenRpc {constructor(){throw Error('fixture_spawn_failure');}}
 const provider=new NativePresentationProvider({host:{command:'fake',args:[]},runtime:{cwd:'fake',env:{}},Rpc:BrokenRpc});
 await expect(provider.generate({userText:'x',assistantText:'y'},new AbortController().signal,{})).rejects.toThrow('fixture_spawn_failure');expect(provider.active).toBeUndefined();
 provider.Rpc=Rpc;expect(await provider.generate({userText:'x',assistantText:'y'},new AbortController().signal,{})).toHaveLength(1);provider.close();
});
it.each(['initialize','turn/start'])('close rejects pending %s without relying on transport failure callback',async phase=>{
 let reached,closed=0;const ready=new Promise(r=>reached=r);
 class SilentRpc extends Rpc {close(){closed++;}async request(method,params){if(method===phase){reached();return new Promise(()=>{});}return super.request(method,params);}}
 const provider=new NativePresentationProvider({host:{command:'fake',args:[]},runtime:{cwd:'fake',env:{}},Rpc:SilentRpc});
 const running=provider.generate({userText:'x',assistantText:'y'},new AbortController().signal,{});const rejected=expect(running).rejects.toThrow('presentation_aborted');await ready;provider.close();await rejected;
 expect(provider.active).toBeUndefined();expect(provider.rpc).toBeUndefined();expect(closed).toBeGreaterThan(0);expect(provider.closed).toBe(true);
});

it('closing after an emitted record never replays or retracts that receipt',async()=>{
 class RecordRpc extends Rpc {
  close(){}
  async request(method,params){if(method!=='turn/start')return super.request(method,params);queueMicrotask(()=>{
   this.notify('item/started',{threadId:'visual-thread',item:{id:'v',type:'agentMessage',phase:'final_answer'}});
   this.notify('item/agentMessage/delta',{threadId:'visual-thread',itemId:'v',delta:'{"mode":"retain","payload":null}'});
  });return {turn:{id:'visual-turn'}};}
 }
 const records=[];const provider=new NativePresentationProvider({host:{command:'fake',args:[]},runtime:{cwd:'fake',env:{}},Rpc:RecordRpc});
 await expect(provider.generate({userText:'x',assistantText:'y'},new AbortController().signal,{}, {isCurrent:()=>true,onRecord:record=>{records.push(record);provider.close();}})).rejects.toThrow('presentation_aborted');
 expect(records).toEqual([{mode:'retain',payload:null}]);expect(provider.active).toBeUndefined();
});
