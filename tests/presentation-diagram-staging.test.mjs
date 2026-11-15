import {runInNewContext} from 'node:vm';
import {it,expect} from 'vitest';
import {prepareDiagram,applyPreparedDiagram,awaitDiagramDwell,revokeDiagramReceipt} from '../integrations/presentation-diagram-staging.mjs';
function fixture(){
 let time=1000;const calls=[],events=[];
 const job={controller:new AbortController(),expiresAt:11000,monotonicDeadline:performance.now()+10000,
   checkpoint:{checkpointRevision:2,textPrefix:'A source.',observedAt:1000},sourceQuote:'A source.',sourceStart:0,sourceEnd:9,sourceAt:1000};
 const bridge={serial:0,selected:job,displayed:null,now:()=>time,valid:j=>j===bridge.selected&&!j.controller.signal.aborted&&time<j.expiresAt,
   remaining:j=>j.expiresAt-time,drain:()=>calls.push('drain'),emit:(type,data)=>events.push({type,...data}),
   evaluate:async(fn,value)=>{calls.push(value);return {status:'accepted',epoch:'e',sceneRevision:2,seq:3};}};
 const record={mode:'compose',payload:{base:'none',parts:[{id:'x',kind:'ellipsoid',center:[0,0,0],scale:[.1,.1,.1]}]},diagram:{}};
 return {bridge,job,record,calls,events,advance:ms=>time+=ms};
}
it('prepares next without obtaining or revoking browser authority',()=>{
 const f=fixture(),old=f.job,next={...old,controller:new AbortController()};
 f.bridge.displayed={expiresAt:9000,owned:{epoch:'e',sceneRevision:1,seq:1}};
 prepareDiagram(f.bridge,next);expect(old.controller.signal.aborted).toBe(true);expect(f.calls).toEqual(['drain']);
 expect(next.scene).toEqual({partIds:[]});expect(f.bridge.displayed.owned.sceneRevision).toBe(1);
});
it('retain and invalid non-absolute record never clear displayed ownership',async()=>{
 const f=fixture();f.bridge.displayed={expiresAt:9000,owned:{epoch:'e',sceneRevision:1,seq:1}};const before=f.bridge.displayed;
 await applyPreparedDiagram(f.bridge,f.job,{mode:'retain'});expect(f.calls).toEqual([]);expect(f.bridge.displayed).toBe(before);
 await expect(applyPreparedDiagram(f.bridge,f.job,{...f.record,payload:{...f.record.payload,base:'current_scene'}})).rejects.toThrow('absolute_required');
});
it('commits a ready absolute record with remaining original TTL and binds receipt',async()=>{
 const f=fixture();f.advance(3000);await applyPreparedDiagram(f.bridge,f.job,f.record);
 expect(f.calls[0].remainingMs).toBe(7000);expect(f.calls[0].expiresAt).toBe(11000);
 expect(f.bridge.displayed).toEqual({expiresAt:11000,owned:{epoch:'e',sceneRevision:2,seq:3}});expect(f.events.at(-1).type).toBe('admitted');
});
it('waits for visible elapsed, not time since acceptance, without renewing expiry',async()=>{
 const f=fixture();f.bridge.displayed={expiresAt:11000,owned:{epoch:'e',sceneRevision:1,seq:1}};let reads=0;
 f.bridge.evaluate=async()=>{reads++;return {current:true,visible:reads>1,visibleElapsedMs:reads>1?2500:0,remainingMs:10000};};
 await awaitDiagramDwell(f.bridge,f.job);expect(reads).toBe(2);expect(f.bridge.displayed.expiresAt).toBe(11000);
});
it.each(['cancel','expiry'])('does not commit after %s while waiting for actual visibility',async mode=>{
 const f=fixture();f.bridge.displayed={expiresAt:11000,owned:{epoch:'e',sceneRevision:1,seq:1}};let applies=0;
 f.bridge.evaluate=async(fn,value)=>{if(value?.body)applies++;if(mode==='cancel')f.job.controller.abort();else f.advance(10000);return {current:true,visible:false,remainingMs:1};};
 await applyPreparedDiagram(f.bridge,f.job,f.record);expect(applies).toBe(0);expect(f.events.some(x=>x.type==='admitted')).toBe(false);
});
it('reject and unknown admission do not fabricate ownership or retry',async()=>{
 const f=fixture(),displayed={expiresAt:11000,owned:{epoch:'e',sceneRevision:1,seq:1}};f.bridge.displayed=displayed;let applies=0;
 f.bridge.evaluate=async(fn,value)=>{if(!value?.body)return {current:false};applies++;throw Error('unknown');};
 await expect(applyPreparedDiagram(f.bridge,f.job,f.record)).rejects.toThrow('unknown');expect(applies).toBe(1);expect(f.bridge.displayed).toBe(displayed);
 expect(f.events.at(-1).type).toBe('admission_unknown');
});
it('old cleared telemetry cannot revoke a newer non-diagram owner',async()=>{
 const f=fixture(),owned={epoch:'e',sceneRevision:2,seq:3};let revokes=0,current=false;
 f.bridge.evaluate=async(fn,value)=>runInNewContext('('+String(fn)+')(value)',{value,window:{fischLive:{diagramLabStatus:()=>({owned,current}),revokePresentation:()=>revokes++}}});
 await revokeDiagramReceipt(f.bridge,owned);expect(revokes).toBe(0);
 current=true;await revokeDiagramReceipt(f.bridge,{...owned,seq:4});expect(revokes).toBe(0);
 await revokeDiagramReceipt(f.bridge,owned);expect(revokes).toBe(1);
});
