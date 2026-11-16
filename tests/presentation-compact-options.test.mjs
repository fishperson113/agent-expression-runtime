import {it,expect,vi,beforeEach} from 'vitest';
const calls=vi.hoisted(()=>[]);
vi.mock('../integrations/presentation-provider.mjs',()=>({NativePresentationProvider:class {constructor(options){calls.push(options);}close(){}}}));
import {LiveStreamingPresentationBridge} from '../integrations/presentation-streaming-bridge.mjs';
import {parseCompactPresentationRecord} from '../integrations/presentation-compact.mjs';
const {NativePresentationProvider}=await vi.importActual('../integrations/presentation-provider.mjs');
beforeEach(()=>{calls.length=0;});
it.each([undefined,'freeform','diagram','compact'])('normalizes the one public protocol %s exactly once',protocol=>{
 const events=[],bridge=new LiveStreamingPresentationBridge({state:{},page:{},protocol,onEvent:e=>events.push(e)});
 expect(calls[0]).toEqual({host:undefined,runtime:undefined,timeoutMs:30000,protocol:protocol==='diagram'?'diagram':'freeform',...(protocol==='compact'?{compact:true}:{})});
 bridge.emit('phase',{phase:'record'});expect(events[0].wireProtocol).toBe(protocol==='compact'?'compact':undefined);
 expect(bridge.protocol).toBe(protocol==='diagram'?'diagram':'freeform');
});
it.each(['Compact','compact ',null,1,{},''])('rejects malformed protocol %s before provider allocation',protocol=>{
 expect(()=>new LiveStreamingPresentationBridge({state:{},page:{},protocol})).toThrow('presentation_protocol_invalid');expect(calls).toEqual([]);
});
it('rejects compact custom-provider conflict before allocation, preserves other custom paths',()=>{
 expect(()=>new LiveStreamingPresentationBridge({protocol:'compact',provider:{}})).toThrow('presentation_compact_provider_conflict');expect(calls).toEqual([]);
 const provider={};expect(new LiveStreamingPresentationBridge({state:{},page:{},provider}).provider).toBe(provider);
});
it('compact accepts exact paragraph/list options without changing diagram source guards',()=>{
 const b=new LiveStreamingPresentationBridge({state:{},page:{},protocol:'compact',paragraphSources:true,listItemSources:true});
 expect(b.paragraphs).not.toBeNull();expect(b.exactExcerptLease).toBe(true);expect(b.ttlMs).toBe(10000);
 expect(()=>new LiveStreamingPresentationBridge({protocol:'diagram',paragraphSources:true})).toThrow('presentation_paragraph_protocol');
 expect(()=>new LiveStreamingPresentationBridge({protocol:'compact',listItemSources:true})).toThrow('presentation_list_sources_invalid');
});
const tuple={base:'replace',parts:[['e','shape',0,0,0,.2,.3,.2]],motions:[[['shape'],[0,0,0],[.1,0,0],[0,0,0],2000,0]]};
class Rpc {
 static calls=[];static output={base:'retain'};static extra=false;
 constructor(_command,_args,_cwd,notify){this.notify=notify;this.settled=Promise.resolve();Rpc.calls=[];}send(){}close(){}
 async request(method,params){Rpc.calls.push({method,params});
  if(method==='config/read')return {config:{features:Object.fromEntries(['shell_tool','apps','plugins','multi_agent','computer_use','browser_use','image_generation','view_image'].map(k=>[k,false])),mcp_servers:{}}};
  if(method==='thread/start')return {thread:{id:'visual'}};if(method==='mcpServerStatus/list')return {data:[]};
  if(method==='turn/start'){queueMicrotask(()=>{
   this.notify('item/started',{threadId:'visual',turnId:'turn',item:{id:'v',type:'agentMessage',phase:'final_answer'}});
   const text=JSON.stringify(Rpc.output);this.notify('item/agentMessage/delta',{threadId:'visual',turnId:'turn',itemId:'v',delta:text});
   if(Rpc.extra)this.notify('item/agentMessage/delta',{threadId:'visual',turnId:'turn',itemId:'v',delta:text});
   this.notify('item/completed',{threadId:'visual',turnId:'turn',item:{id:'v',type:'agentMessage',phase:'final_answer',text}});
   this.notify('turn/completed',{threadId:'visual',turn:{id:'turn',status:'completed'}});
  });return {turn:{id:'turn'}};}return {};
 }
}
it.each(['tuple','retain','malformed','extra'])('alias-selected actual provider keeps canonical streaming contract: %s',async kind=>{
 new LiveStreamingPresentationBridge({state:{},page:{},protocol:'compact'});
 const provider=new NativePresentationProvider({...calls[0],host:{command:'fake',args:[]},runtime:{cwd:'fake',env:{}},Rpc});
 Rpc.output=kind==='retain'?{base:'retain'}:kind==='malformed'?{base:'replace'}:tuple;Rpc.extra=kind==='extra';const records=[];
 const exchange={userText:'Explain a relation.',assistantText:'A complete source statement.',target:'A complete source statement.',publicContext:'Full prior context and qualifications.'};
 try{const result=provider.generate(exchange,new AbortController().signal,{}, {isCurrent:()=>true,onRecord:r=>records.push(r)});
 if(kind==='malformed'||kind==='extra')await expect(result).rejects.toThrow(kind==='extra'?'presentation_record_extra':'presentation_record_invalid');else await result;
 if(kind==='malformed')expect(records).toEqual([]);else expect(records).toEqual([parseCompactPresentationRecord(JSON.stringify(Rpc.output))]);
 const thread=Rpc.calls.find(c=>c.method==='thread/start').params,turn=Rpc.calls.find(c=>c.method==='turn/start').params;
 expect(thread.baseInstructions).toContain('e tuple');expect(thread.model).toBeUndefined();expect(turn.effort).toBeUndefined();
 const input=JSON.parse(turn.input[0].text);expect(input.target).toBe(exchange.target);expect(input.publicContext).toBe(exchange.publicContext);
 }finally{provider.close();Rpc.extra=false;}
});
