import { expect, it } from 'vitest';
import { PrefetchPresentationProvider } from '../integrations/presentation-prefetch.mjs';
class Provider {
  constructor(){this.calls=[];this.protocol='diagram';}
  generate(exchange,signal,scene,streaming){return new Promise((resolve,reject)=>{
    const call={exchange,signal,streaming,resolve,reject};this.calls.push(call);
    signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
  });}
  close(){this.closed=true;}
}
const record={mode:'retain',reason:'not_visual'};
function fixture(){const primary=new Provider(),speculative=new Provider();return {primary,speculative,p:new PrefetchPresentationProvider({primary,speculative})};}
const data=id=>({userText:'explain',target:`source ${id}`,publicContext:`context ${id}`});
const source=id=>({turnId:'t',revision:id,sourceStart:0,sourceEnd:8,expiresAt:1000,monotonicDeadline:1000});
function options(){const c=new AbortController();return {c,signal:c.signal,isCurrent:()=>true,remainingMs:()=>1000};}
const tick=()=>new Promise(r=>setTimeout(r,0));
it('prefetch stays private until exact source is selected, without a duplicate model call',async()=>{
 const {p,primary,speculative}=fixture(),o=options(),seen=[];p.prefetch(data(1),source(1),o);await tick();
 speculative.calls[0].streaming.onRecord(record);expect(seen).toEqual([]);
 const run=p.generate(data(1),o.signal,{}, {sourceIdentity:source(1),isCurrent:()=>true,onRecord:r=>seen.push(r)});
 expect(seen).toEqual([record]);expect(primary.calls).toHaveLength(0);
 speculative.calls[0].resolve();await run;p.close();
});
it('two busy lanes keep only the newest pending speculative request',async()=>{
 const {p,primary,speculative}=fixture(),o=options();
 const main=p.generate(data(0),o.signal,{}, {sourceIdentity:source(0),isCurrent:()=>true,onRecord(){}});
 p.prefetch(data(1),source(1),o);p.prefetch(data(2),source(2),o);p.prefetch(data(3),source(3),o);await tick();
 expect(primary.calls).toHaveLength(1);expect(speculative.calls).toHaveLength(1);
 speculative.calls[0].resolve();await tick();expect(speculative.calls).toHaveLength(2);expect(speculative.calls[1].exchange).toEqual(data(3));
 primary.calls[0].resolve();await main;speculative.calls[1].resolve();await tick();p.close();
});
it.each(['context','owner','range','revision','configuration'])('does not reuse output after %s changes',async kind=>{
 const {p,primary,speculative}=fixture(),o=options();p.prefetch(data(1),source(1),o);await tick();
 speculative.calls[0].streaming.onRecord(record);speculative.calls[0].resolve();await tick();
 const exchange=data(1),identity=source(1);
 if(kind==='context')exchange.publicContext='new qualifier';if(kind==='owner')identity.turnId='new';
 if(kind==='range')identity.sourceStart=1;if(kind==='revision')identity.revision=2;if(kind==='configuration'){primary.visualModel='other';speculative.visualModel='other';}
 const seen=[];const main=p.generate(exchange,o.signal,{}, {sourceIdentity:identity,isCurrent:()=>true,onRecord:r=>seen.push(r)});
 expect(primary.calls).toHaveLength(1);expect(seen).toEqual([]);primary.calls[0].resolve();await main;p.close();
});
it('original expiry cannot be renewed when a cached result is claimed',async()=>{
 const {p,primary,speculative}=fixture(),o=options();let remaining=1000;o.remainingMs=()=>remaining;
 p.prefetch(data(1),source(1),o);await tick();speculative.calls[0].streaming.onRecord(record);speculative.calls[0].resolve();await tick();remaining=0;
 const main=p.generate(data(1),o.signal,{}, {sourceIdentity:source(1),isCurrent:()=>false,onRecord(){throw Error('stale painted');}});
 await expect(main).rejects.toThrow('presentation_unavailable');expect(primary.calls).toHaveLength(0);p.close();
});
it('source invalidation cancels speculative work and drops cache/queue; late record cannot paint',async()=>{
 const {p,speculative}=fixture(),o=options();p.prefetch(data(1),source(1),o);p.prefetch(data(2),source(2),o);await tick();
 p.invalidate();await tick();expect(speculative.calls[0].signal.aborted).toBe(true);expect(speculative.calls).toHaveLength(1);
 expect(()=>speculative.calls[0].streaming.onRecord(record)).toThrow('prefetch_source_stale');expect(p.cached).toBeNull();p.close();
});
it('cancelling a promoted speculative job cancels its real provider and rejects pending publish',async()=>{
 const {p,speculative}=fixture(),o=options();p.prefetch(data(1),source(1),o);await tick();const c=new AbortController();
 const main=p.generate(data(1),c.signal,{}, {sourceIdentity:source(1),isCurrent:()=>true,onRecord(){}});
 c.abort();await expect(main).rejects.toThrow('aborted');expect(speculative.calls[0].signal.aborted).toBe(true);p.close();
});
it('old prefetch completion never publishes into a newer primary job',async()=>{
 const {p,primary,speculative}=fixture(),o=options(),seen=[];p.prefetch(data(1),source(1),o);await tick();
 const main=p.generate(data(2),o.signal,{}, {sourceIdentity:source(2),isCurrent:()=>true,onRecord:r=>seen.push(r)});
 speculative.calls[0].streaming.onRecord(record);speculative.calls[0].resolve();await tick();expect(seen).toEqual([]);
 primary.calls[0].resolve();await main;p.close();
});
it('requires independent lanes with matching declared model and policy settings',()=>{
 const one=new Provider();expect(()=>new PrefetchPresentationProvider({primary:one,speculative:one})).toThrow('independent');
 const {p,speculative}=fixture();speculative.visualModel='different';expect(()=>p.prefetch(data(1),source(1),options())).toThrow('configuration_mismatch');p.close();
});
it('a speculative record followed by correction/error is never replayed from cache',async()=>{
 const {p,primary,speculative}=fixture(),o=options(),seen=[];p.prefetch(data(1),source(1),o);await tick();
 speculative.calls[0].streaming.onRecord(record);speculative.calls[0].reject(Error('presentation_stream_corrected'));await tick();
 expect(p.cached).toBeUndefined();
 const main=p.generate(data(1),o.signal,{}, {sourceIdentity:source(1),isCurrent:()=>true,onRecord:r=>seen.push(r)});
 expect(seen).toEqual([]);expect(primary.calls).toHaveLength(1);primary.calls[0].resolve();await main;p.close();
});
it('rechecks source immediately before speculative model dispatch',async()=>{
 const {p,speculative}=fixture(),o=options();let current=true;o.isCurrent=()=>current;
 p.prefetch(data(1),source(1),o);current=false;await tick();expect(speculative.calls).toHaveLength(0);p.close();
});
