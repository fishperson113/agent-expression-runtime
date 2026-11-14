import {it,expect} from 'vitest';
import {NativePresentationProvider} from '../integrations/presentation-provider.mjs';
import {LiveStreamingPresentationBridge} from '../integrations/presentation-streaming-bridge.mjs';
import {livePageQuery} from '../integrations/live-launch.mjs';
const exchange={target:'Queues buffer work.',userText:'Explain queues',assistantText:'Public native answer',publicContext:'Earlier explanation',privateReasoning:'NEVER_SEND'};
const record=JSON.stringify({mode:'diagram',unitId:'u0',nodes:[{id:'queue',term:'Queues',slot:0},{id:'work',term:'work',slot:1}],edges:[{id:'buffer',from:'queue',to:'work',predicate:'buffer',direction:'none'}]});
function fixture({holdSettlement=false}={}){
 const calls=[],emitted=[];let notify,readyResolve,settle,closed=0,current=true;
 const ready=new Promise(r=>readyResolve=r);
 const features=Object.fromEntries(['shell_tool','apps','plugins','multi_agent','computer_use','browser_use','image_generation','view_image'].map(k=>[k,false]));
 class Rpc{
  constructor(_c,args,_cwd,n){notify=n;calls.push({args});this.settled=holdSettlement?new Promise(r=>settle=r):Promise.resolve();}
  send(){}close(){closed++;}
  async request(method,params){calls.push({method,params});
   if(method==='config/read')return {config:{features,mcp_servers:{}}};
   if(method==='thread/start')return {thread:{id:'visual'}};
   if(method==='mcpServerStatus/list')return {data:[]};
   if(method==='turn/start'){readyResolve();return {turn:{id:'turn'}};}return {};
  }
 }
 const provider=new NativePresentationProvider({host:{command:'mock',args:[]},runtime:{cwd:'fixture',env:{}},Rpc,protocol:'diagram'});
 const controller=new AbortController();
 const stream={isCurrent:()=>current,onRecord:r=>emitted.push(r)};
 const event=(method,params)=>notify(method,{threadId:'visual',turnId:'turn',...params});
 const start=()=>event('item/started',{item:{id:'item',type:'agentMessage',phase:'final_answer'}});
 const delta=text=>event('item/agentMessage/delta',{itemId:'item',delta:text});
 const finish=(text=record)=>{event('item/completed',{item:{id:'item',type:'agentMessage',phase:'final_answer',text}});event('turn/completed',{turn:{id:'turn',status:'completed'}});};
 return {provider,controller,ready,calls,emitted,stream,start,delta,finish,settle:()=>settle?.(),closed:()=>closed,stale:()=>current=false};
}
it('diagram opt-in uses shared streaming lifecycle and exact public source without altering native data',async()=>{
 const f=fixture(),before=structuredClone(exchange);let done=false;
 const running=f.provider.generate(exchange,f.controller.signal,{},f.stream).then(()=>done=true);await f.ready;f.start();
 f.delta(record.slice(0,30));expect(f.emitted).toHaveLength(0);f.delta(record.slice(30));expect(f.emitted).toHaveLength(1);expect(done).toBe(false);
 expect(f.emitted[0].diagram.plan.caption.text).toBe(exchange.target);expect(f.emitted[0].diagram.plan.edges[0].predicate).toBe('buffer');
 const request=f.calls.find(c=>c.method==='turn/start').params;const input=JSON.parse(request.input[0].text);
 expect(input.units).toEqual([{unitId:'u0',text:exchange.target}]);expect(input.context.publicPrefix).toBe(exchange.publicContext);expect(request.input[0].text).not.toContain('NEVER_SEND');
 const thread=f.calls.find(c=>c.method==='thread/start').params;expect(thread.baseInstructions).toContain('Use zero edges');expect(thread.model).toBeUndefined();expect(request.effort).toBeUndefined();
 f.finish();await running;expect(f.emitted).toHaveLength(1);expect(exchange).toEqual(before);expect(f.provider.active).toBeUndefined();f.provider.close();
});
it.each(['stale','abort','invented','corrected'])('diagram %s fails closed without replay',async kind=>{
 const f=fixture(),running=f.provider.generate(exchange,f.controller.signal,{},f.stream);const rejected=expect(running).rejects.toThrow();await f.ready;f.start();
 if(kind==='abort')f.controller.abort();
 if(kind==='stale'){f.delta(record.slice(0,30));f.stale();f.delta(record.slice(30));}
 if(kind==='invented')f.delta(record.replace('Queues','Invented'));
 if(kind==='corrected'){f.delta(record);f.finish(record+' ');}
 await rejected;expect(f.emitted).toHaveLength(kind==='corrected'?1:0);expect(f.closed()).toBeGreaterThan(0);expect(f.provider.active).toBeUndefined();f.provider.close();
});
it('aborted diagram retains process ownership until transport settlement',async()=>{
 const f=fixture({holdSettlement:true});let ended=false;
 const running=f.provider.generate(exchange,f.controller.signal,{},f.stream).catch(e=>{ended=true;expect(e.message).toBe('presentation_aborted');});await f.ready;f.controller.abort();
 await new Promise(r=>setTimeout(r,0));expect(ended).toBe(false);expect(f.provider.active).toBeDefined();
 await expect(f.provider.generate(exchange,new AbortController().signal,{},f.stream)).rejects.toThrow('presentation_unavailable');
 f.settle();await running;expect(f.provider.active).toBeUndefined();f.provider.close();
});
it('rejects nonstreaming diagram and unknown protocol before opening transport',async()=>{
 const f=fixture();await expect(f.provider.generate(exchange,f.controller.signal,{})).rejects.toThrow('diagram_requires_streaming');expect(f.calls).toEqual([]);f.provider.close();
 expect(()=>new NativePresentationProvider({runtime:{cwd:'fixture',env:{}},protocol:'unknown'})).toThrow('presentation_protocol_invalid');
});
it('launch and bridge opt in only for diagram, preserving default freeform and rejecting unknown lane config',()=>{
 expect(livePageQuery({}).has('diagramLab')).toBe(false);expect(livePageQuery({FISCH_PRESENTATION_PROTOCOL:'freeform'}).has('diagramLab')).toBe(false);
 expect(livePageQuery({FISCH_PRESENTATION_PROTOCOL:'diagram',FISCH_VISION_DELEGATE:'CPU'},true).toString()).toBe('vision=cpu&fixture=synthetic&diagramLab=1');
 expect(livePageQuery({FISCH_PRESENTATION_PROTOCOL:'oops'}).has('diagramLab')).toBe(false);
 const args={state:{},page:{},provider:{close(){}}};const normal=new LiveStreamingPresentationBridge(args),diagram=new LiveStreamingPresentationBridge({...args,protocol:'diagram'});
 expect(normal.exactExcerptLease).toBe(false);expect(diagram.exactExcerptLease).toBe(true);expect(diagram.boundedSourceLease).toBe(true);
 expect(()=>new LiveStreamingPresentationBridge({...args,protocol:'oops'})).toThrow('presentation_protocol_invalid');normal.close();diagram.close();
});
