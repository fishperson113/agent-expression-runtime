import { expect, it } from 'vitest';
import { NativePresentationProvider } from '../integrations/presentation-provider.mjs';
class Rpc {
  static instances = [];
  constructor(_c,_a,_d,notify,failed) {
    Object.assign(this,{notify,failed,calls:[],closed:false});Rpc.instances.push(this);
    this.settled=new Promise(resolve=>this.finish=resolve);
  }
  send() {}
  close() { if(this.closed)return;this.closed=true;this.finish();this.failed('closed'); }
  async request(method,params) {
    this.calls.push({method,params});
    if(method==='config/read')return {config:{features:Object.fromEntries(['shell_tool','apps','plugins','multi_agent','computer_use','browser_use','image_generation','view_image'].map(k=>[k,false]))}};
    if(method==='thread/start')return {thread:{id:`thread-${this.calls.length}`}};
    if(method==='mcpServerStatus/list')return {data:[]};
    if(method==='turn/start') {
      if(this.hold)return new Promise(()=>{});
      const turn={id:`turn-${this.calls.length}`,status:'completed'};
      queueMicrotask(()=>{
        this.notify('item/completed',{threadId:params.threadId,item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify({reply:'',scenes:[{holdMs:1000,decision:{mode:'retain',reasonCode:'ordinary',payload:null}}]})}});
        this.notify('turn/completed',{threadId:params.threadId,turn});
      });return {turn};
    }
    return {};
  }
}
const make=options=>new NativePresentationProvider({host:{command:'fake',args:[]},runtime:{cwd:'fake',env:{}},Rpc,warmTransport:options??true});
const run=(p,signal=new AbortController().signal)=>p.generate({userText:'a',assistantText:'public'},signal,{});
it('reuses transport, not threads, and rechecks isolation for every job',async()=>{
  Rpc.instances=[];const p=make();try {
    await run(p);await run(p);expect(Rpc.instances).toHaveLength(1);
    const calls=Rpc.instances[0].calls;
    expect(calls.filter(x=>x.method==='initialize')).toHaveLength(1);
    expect(calls.filter(x=>x.method==='config/read')).toHaveLength(2);
    expect(calls.filter(x=>x.method==='mcpServerStatus/list')).toHaveLength(2);
    const turns=calls.filter(x=>x.method==='turn/start');expect(turns[0].params.threadId).not.toBe(turns[1].params.threadId);
    expect(calls.filter(x=>x.method==='thread/start').every(x=>x.params.ephemeral===true)).toBe(true);
  } finally {p.close();}expect(Rpc.instances[0].closed).toBe(true);
});
it('abort destroys process, rejects overlapping job, then starts clean transport',async()=>{
  Rpc.instances=[];const p=make();await run(p);const first=Rpc.instances[0];first.hold=true;
  const controller=new AbortController();const pending=run(p,controller.signal);
  await expect(run(p)).rejects.toThrow('presentation_unavailable');
  controller.abort();await expect(pending).rejects.toThrow('presentation_aborted');
  expect(first.closed).toBe(true);await run(p);expect(Rpc.instances).toHaveLength(2);p.close();
});
it('retires bounded job count and idle lifetime without replay',async()=>{
  Rpc.instances=[];const p=make({maxJobs:2,idleMs:10});await run(p);await run(p);
  expect(Rpc.instances[0].closed).toBe(true);await run(p);expect(Rpc.instances).toHaveLength(2);
  await new Promise(r=>setTimeout(r,25));expect(Rpc.instances[1].closed).toBe(true);p.close();
});
it('close during active job rejects it and permanently disallows reuse',async()=>{
  Rpc.instances=[];const p=make();await run(p);Rpc.instances[0].hold=true;
  const pending=run(p);await Promise.resolve();p.close();await expect(pending).rejects.toThrow();
  await expect(run(p)).rejects.toThrow('presentation_unavailable');
});
it('late previous thread notifications cannot complete a new job',async()=>{
  Rpc.instances=[];const p=make();await run(p);const rpc=Rpc.instances[0];
  const old=rpc.calls.find(x=>x.method==='turn/start').params.threadId;rpc.hold=true;
  const c=new AbortController();const pending=run(p,c.signal);await new Promise(r=>setTimeout(r,1));
  let complete=false;pending.then(()=>complete=true,()=>{});
  rpc.notify('turn/completed',{threadId:old,turn:{id:'old',status:'completed'}});
  await Promise.resolve();expect(complete).toBe(false);c.abort();await expect(pending).rejects.toThrow();p.close();
});
it('rechecks config after reuse and retires on isolation failure without inference',async()=>{
  Rpc.instances=[];const p=make();await run(p);const rpc=Rpc.instances[0];
  const request=rpc.request.bind(rpc);rpc.request=(method,params)=>method==='config/read'?Promise.resolve({config:{features:{}}}):request(method,params);
  const before=rpc.calls.filter(x=>x.method==='turn/start').length;
  await expect(run(p)).rejects.toThrow('presentation_isolation');
  expect(rpc.calls.filter(x=>x.method==='turn/start')).toHaveLength(before);expect(rpc.closed).toBe(true);p.close();
});
it('waits for retired process settlement before spawning replacement',async()=>{
  Rpc.instances=[];const p=make({maxJobs:1,idleMs:1000});
  const pending=run(p);await Promise.resolve();const first=Rpc.instances[0];
  first.close=()=>{first.closed=true;};
  let completed=false;pending.then(()=>completed=true);await new Promise(r=>setTimeout(r,2));
  expect(first.closed).toBe(true);expect(completed).toBe(false);
  await expect(run(p)).rejects.toThrow('presentation_unavailable');expect(Rpc.instances).toHaveLength(1);
  first.finish();await pending;await run(p);expect(Rpc.instances).toHaveLength(2);p.close();
});
it('abort keeps provider busy until killed process actually settles',async()=>{
  Rpc.instances=[];const p=make();await run(p);const rpc=Rpc.instances[0];rpc.hold=true;rpc.close=()=>{rpc.closed=true;};
  const c=new AbortController();const pending=run(p,c.signal);await new Promise(r=>setTimeout(r,1));c.abort();
  let ended=false;pending.catch(()=>ended=true);await Promise.resolve();expect(ended).toBe(false);
  await expect(run(p)).rejects.toThrow('presentation_unavailable');expect(Rpc.instances).toHaveLength(1);
  rpc.finish();await expect(pending).rejects.toThrow('presentation_aborted');await run(p);expect(Rpc.instances).toHaveLength(2);p.close();
});
for(const failure of ['malformed','corrected'])it(`streaming ${failure} record destroys warm transport`,async()=>{
  Rpc.instances=[];const p=make();await run(p);const rpc=Rpc.instances[0];rpc.hold=true;
  const pending=p.generate({userText:'a',assistantText:'public'},new AbortController().signal,{}, {isCurrent:()=>true,onRecord(){}});
  await new Promise(r=>setTimeout(r,1));const threadId=rpc.calls.filter(x=>x.method==='turn/start').at(-1).params.threadId;
  rpc.notify('item/started',{threadId,item:{id:'v',type:'agentMessage',phase:'final_answer'}});
  const text='{"mode":"retain","payload":null}';
  rpc.notify('item/agentMessage/delta',{threadId,itemId:'v',delta:failure==='malformed'?'not-json\n':text});
  if(failure==='corrected')rpc.notify('item/completed',{threadId,item:{id:'v',type:'agentMessage',phase:'final_answer',text:text+' '}});
  await expect(pending).rejects.toThrow();expect(rpc.closed).toBe(true);await run(p);expect(Rpc.instances).toHaveLength(2);p.close();
});
it('late old streaming delta cannot publish into the next thread',async()=>{
  Rpc.instances=[];const p=make();await run(p);const rpc=Rpc.instances[0];rpc.hold=true;
  const old=rpc.calls.find(x=>x.method==='turn/start').params.threadId;const c=new AbortController();const records=[];
  const pending=p.generate({userText:'a',assistantText:'public'},c.signal,{}, {isCurrent:()=>true,onRecord:r=>records.push(r)});
  await new Promise(r=>setTimeout(r,1));
  rpc.notify('item/started',{threadId:old,item:{id:'old-v',type:'agentMessage',phase:'final_answer'}});
  rpc.notify('item/agentMessage/delta',{threadId:old,itemId:'old-v',delta:'{"mode":"retain","payload":null}'});
  expect(records).toEqual([]);c.abort();await expect(pending).rejects.toThrow();p.close();
});
