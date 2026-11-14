import { afterEach, expect, it, vi } from 'vitest';
import { PresentationAdmission } from '../src/live/presentation-admission';
import { LiveBody } from '../src/live/body';
vi.mock('../src/adapters/three-renderer', () => ({ ThreeRenderer: class {
  count=2000; renderSnapshot={contextLost:false,frame:0,signature:'test'}; quality(){} resize(){} apply(){} dispose(){}
} }));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const identity={documentId:'doc',threadId:'thread',turnId:'turn',generation:1};
function fixture(){
 const state:any={documentId:'doc',stopped:false,hidden:false,busy:false,scene:{epoch:'epoch',revision:1,partIds:['face']},
 snapshot:{threadId:'thread',generation:1,available:true,pending:false,stopping:false,ownerTurn:null,messages:[{role:'user',turn:'turn'},{role:'assistant',turn:'turn',status:'completed',truncated:false}]}};
 const admit=vi.fn((_body,scope,valid)=>valid()?{status:'accepted',sceneRevision:++state.scene.revision}:{status:'rejected'});
 const gate=new PresentationAdmission(()=>state,admit,()=>0);return {state,admit,gate};
}
it('atomically scopes admission and chains only its own accepted revision',()=>{
 const {gate,admit,state}=fixture();const shot=gate.snapshot(identity)!;expect(shot.partIds).toEqual(['face']);
 const first:any=gate.apply({scope:shot.scope,body:{type:'wait'}});expect(first.status).toBe('accepted');
 expect(gate.apply({scope:shot.scope,body:{}}).code).toBe('presentation_stale');
 expect(gate.apply({scope:first.scope,body:{}}).status).toBe('accepted');expect(admit).toHaveBeenCalledTimes(2);
 expect(state.snapshot.messages[1]).toEqual({role:'assistant',turn:'turn',status:'completed',truncated:false});
});
it.each(['intent','hidden','stop','document','thread','turn','revision','epoch','generation'])('rejects %s without mutation',reason=>{
 const {gate,admit,state}=fixture(),shot=gate.snapshot(identity)!;
 if(reason==='intent')gate.invalidate();if(reason==='hidden')state.hidden=true;if(reason==='stop')state.stopped=true;
 if(reason==='thread')state.snapshot.threadId='new';if(reason==='document')state.documentId='new';if(reason==='turn')state.snapshot.messages.push({role:'user',turn:'new'});
 if(reason==='epoch')state.scene.epoch='new';if(reason==='generation')state.snapshot.generation++;if(reason==='revision')state.scene.revision++;
 expect(gate.apply({scope:shot.scope,body:{}}).status).toBe('rejected');expect(admit).not.toHaveBeenCalled();
});
it('busy retry retains exact scope but newer intent still rejects',()=>{
 const {gate,admit,state}=fixture(),shot=gate.snapshot(identity)!;state.busy=true;state.scene=null;
 expect(gate.apply({scope:shot.scope,body:{}}).code).toBe('presentation_busy');expect(admit).not.toHaveBeenCalled();
 gate.invalidate();expect(gate.apply({scope:shot.scope,body:{}}).code).toBe('presentation_stale');
});
it('rejects incomplete chat and provider-shaped invalid data without touching messages',()=>{
 const {gate,state}=fixture();state.snapshot.ownerTurn='turn';expect(gate.snapshot(identity)).toBeNull();
 expect(gate.apply(null as any).status).toBe('rejected');
});
it('LiveBody validates DSL and scope before revoking ownership; valid scene receipt tracks target',()=>{
 let now=1000;vi.spyOn(performance,'now').mockImplementation(()=>now);vi.stubGlobal('document',{hidden:false});
 vi.stubGlobal('devicePixelRatio',1);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{});
 const body=new LiveBody({getBoundingClientRect:()=>({width:800,height:600})} as HTMLCanvasElement,()=>{});
 now+=1000;body.scheduler.tick();const current=body.chatSceneContext()!;const scope={epoch:current.epoch,sceneRevision:current.revision};
 const mutate=vi.spyOn(body,'prepareUserMutation');
 expect(body.admitPresentation({type:'not-a-dsl'},scope,()=>true).status).toBe('rejected');expect(mutate).not.toHaveBeenCalled();
 expect(body.admitPresentation({type:'wait',durationMs:1},scope,()=>false).status).toBe('rejected');expect(mutate).not.toHaveBeenCalled();
 let checks=0;expect(body.admitPresentation({type:'wait',durationMs:1},scope,()=>++checks===1).status).toBe('rejected');expect(mutate).not.toHaveBeenCalled();
 const result=body.admitPresentation({type:'assemble',durationMs:100,parts:[{id:'new',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]}]},scope,()=>true);
 expect(result.status).toBe('accepted');if(result.status!=='accepted')throw Error('admission failed');expect(result.sceneRevision).toBeGreaterThan(scope.sceneRevision);expect(mutate).toHaveBeenCalledOnce();
 now+=200;body.scheduler.tick();expect(body.chatSceneContext()?.revision).toBe(result.sceneRevision);
 const owned={epoch:result.epoch,sceneRevision:result.sceneRevision!,seq:result.seq};
 expect(body.revokePresentationGeometry({...owned,sceneRevision:owned.sceneRevision+1})).toBe(false);
 expect(body.revokePresentationGeometry({...owned,epoch:'other'})).toBe(false);
 expect(body.revokePresentationGeometry({...owned,seq:owned.seq-1})).toBe(false);
 expect(body.revokePresentationGeometry(owned)).toBe(true);
 expect(body.scheduler.sceneParts.some(p=>p.id==='new')).toBe(false);
 expect(body.revokePresentationGeometry(owned)).toBe(false);body.dispose();
});

it('projects only identity fields and rejects negative generations',()=>{
 const {gate}=fixture();expect(gate.snapshot({...identity,generation:-1})).toBeNull();
 const value=gate.snapshot({...identity,privateText:'SECRET'} as any);expect(JSON.stringify(value)).not.toContain('SECRET');
});

it('expires the chain without renewing its lease on scenes',()=>{
 const {state}=fixture();let now=0;const admit=vi.fn(()=>({status:'accepted',sceneRevision:state.scene.revision}));
 const gate=new PresentationAdmission(()=>state,admit,()=>now), shot=gate.snapshot(identity)!;
 now=119999;const receipt:any=gate.apply({scope:shot.scope,body:{}});expect(receipt.status).toBe('accepted');
 now=120000;expect(gate.apply({scope:receipt.scope,body:{}}).code).toBe('presentation_stale');expect(admit).toHaveBeenCalledOnce();
});


it('opt-in source excerpt survives append-only headings within original bounded deadline',()=>{
 const {state,admit}=fixture();let now=0;
 const gate=new PresentationAdmission(()=>state,admit,()=>now,()=>{},true);
 const prefix='A complete source sentence.';
 Object.assign(state.snapshot,{ownerTurn:'turn',revision:1});Object.assign(state.snapshot.messages[1],{id:'a',text:prefix,status:'streaming'});
 const shot=gate.snapshot({...identity,messageId:'a',textPrefix:prefix,publicRevision:1,remainingTtlMs:30000,section:0})!;
 state.snapshot.messages[1].text+='\n**Another section**\nMore text.';state.snapshot.revision++;
 expect(gate.reconcile()).toBe(false);const result=gate.apply({scope:shot.scope,body:{}});expect(result.status).toBe('accepted');
 expect(gate.leaseDeadline(result.scope)).toBe(10000);now=10000;expect(gate.leaseDeadline(result.scope)).toBeNull();
 state.snapshot.messages[1].text='rewritten';expect(gate.reconcile()).toBe(true);
});

it('reconciles original expiry even while busy, but preserves a live busy scope',()=>{
 const {state,admit}=fixture();let now=0;const clear=vi.fn();
 const gate=new PresentationAdmission(()=>state,admit,()=>now,clear);
 const shot=gate.snapshot(identity)!;state.busy=true;state.scene=null;
 now=119999;expect(gate.reconcile()).toBe(false);expect(gate.leaseDeadline(shot.scope)).toBe(120000);
 now=120000;expect(gate.reconcile()).toBe(true);expect(clear).toHaveBeenCalledOnce();
 expect(gate.leaseDeadline(shot.scope)).toBeNull();expect(gate.reconcile()).toBe(false);
});
it.each(['epoch','revision'])('rejects deadline for replaced scene %s without mutating its geometry',key=>{
 const {state,admit}=fixture();const clear=vi.fn();const gate=new PresentationAdmission(()=>state,admit,()=>0,clear);
 const shot=gate.snapshot(identity)!;if(key==='epoch')state.scene.epoch='other';else state.scene.revision++;
 const replacement={...state.scene};expect(gate.leaseDeadline(shot.scope)).toBeNull();expect(gate.reconcile()).toBe(true);
 expect(state.scene).toEqual(replacement);expect(admit).not.toHaveBeenCalled();expect(clear).toHaveBeenCalledOnce();
});
it('reconcile fails closed after clock regression',()=>{
 const {state,admit}=fixture();let now=10;const gate=new PresentationAdmission(()=>state,admit,()=>now);
 gate.snapshot(identity);now=9;expect(gate.reconcile()).toBe(true);
});
