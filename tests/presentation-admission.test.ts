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
function sourcedFixture(){
 const f=fixture();let now=0;const gate=new PresentationAdmission(()=>f.state,f.admit,()=>now,()=>{},true);
 const prefix='Repeat. Repeat.';Object.assign(f.state.snapshot,{ownerTurn:'turn',revision:1});
 Object.assign(f.state.snapshot.messages[1],{id:'a',text:prefix,status:'streaming'});
 const request={...identity,messageId:'a',textPrefix:prefix,publicRevision:1,remainingTtlMs:1000,section:0,sourceStart:8,sourceEnd:15,sourceQuote:'Repeat.'};
 return {...f,gate,request,time:(n:number)=>now=n};
}
it('binds the exact repeated occurrence and rejects forged receipt source fields',()=>{
 const {gate,request,admit}=sourcedFixture();const shot=gate.snapshot(request)!;
 expect(shot.scope).toMatchObject({sourceStart:8,sourceEnd:15,sourceQuote:'Repeat.'});
 for(const patch of [{sourceStart:0,sourceEnd:7},{sourceQuote:'Different.'},{sourceEnd:14}])
 expect(gate.apply({scope:{...shot.scope,...patch},body:{}}).code).toBe('presentation_stale');
 expect(admit).not.toHaveBeenCalled();expect(gate.apply({scope:shot.scope,body:{}}).status).toBe('accepted');
});
it('validates all-or-none source bounds and exact quote before issuing scope',()=>{
 const {gate,request}=sourcedFixture();
 for(const patch of [{sourceStart:undefined},{sourceStart:-1},{sourceStart:1.5},{sourceEnd:100},{sourceEnd:8},{sourceQuote:'not present'}])
 expect(gate.snapshot({...request,...patch})).toBeNull();
 const {sourceEnd,...partial}=request;expect(gate.snapshot(partial)).toBeNull();
 expect(gate.snapshot({...identity,sourceStart:0,sourceEnd:7,sourceQuote:'Repeat.'})).toBeNull();
});
it('does not attach author-invented source metadata to a legacy generic scope',()=>{
 const {gate}=fixture();const shot=gate.snapshot(identity)!;
 expect(shot.scope).not.toHaveProperty('sourceQuote');
 expect(gate.apply({scope:{...shot.scope,sourceStart:0,sourceEnd:1,sourceQuote:'x'},body:{}}).status).toBe('rejected');
 expect(gate.apply({scope:shot.scope,body:{}}).status).toBe('accepted');
});
it('preserves original expiry across sourced scene receipts and rejects source rewriting',()=>{
 const f=sourcedFixture(),shot=f.gate.snapshot(f.request)!;f.time(900);
 const receipt=f.gate.apply({scope:shot.scope,body:{}});expect(receipt.status).toBe('accepted');
 expect(f.gate.leaseDeadline(receipt.scope)).toBe(1000);f.time(1000);
 expect(f.gate.apply({scope:receipt.scope,body:{}}).status).toBe('rejected');
 const g=sourcedFixture(),before=g.gate.snapshot(g.request)!;g.state.snapshot.messages[1].text='Edited. Repeat.';
 expect(g.gate.apply({scope:before.scope,body:{}}).status).toBe('rejected');
});
it('rejects UTF-16 boundaries inside an emoji',()=>{
 const f=sourcedFixture();f.state.snapshot.messages[1].text='A\u{1f600}B';
 const request={...f.request,textPrefix:'A\u{1f600}B'};
 expect(f.gate.snapshot({...request,sourceStart:2,sourceEnd:3,sourceQuote:'\ude00'})).toBeNull();
 expect(f.gate.snapshot({...request,sourceStart:1,sourceEnd:2,sourceQuote:'\ud83d'})).toBeNull();
 expect(f.gate.snapshot({...request,sourceStart:1,sourceEnd:3,sourceQuote:'\u{1f600}'})).not.toBeNull();
});
it('transactional replacement preserves displayed lease through candidate rejection and expiry',()=>{
 const f=sourcedFixture();let now=0;const clear=vi.fn();let reject=false;
 const gate=new PresentationAdmission(()=>f.state,(_body,scope,valid)=>{
  expect(gate.leaseDeadline(scope)).not.toBeNull();
  return reject?{status:'rejected',code:'bad_geometry'}:f.admit(_body,scope,valid);
 },()=>now,clear,true);
 const first=gate.replace({identity:f.request,body:{}});expect(first.status).toBe('accepted');
 now=200;reject=true;const next={...f.request,sourceStart:0,sourceEnd:7,remainingTtlMs:2000};
 expect(gate.replace({identity:next,body:{}}).code).toBe('bad_geometry');
 expect(gate.leaseDeadline(first.scope)).toBe(1000);expect(clear).not.toHaveBeenCalled();
 now=1000;expect(gate.reconcile()).toBe(true);expect(clear).toHaveBeenCalledOnce();
});
it('candidate callback can inspect both leases; success alone transfers authority with original remaining TTL',()=>{
 const f=sourcedFixture();let now=0;let old:any;let candidateScope:any;
 const gate=new PresentationAdmission(()=>f.state,(body,scope,valid)=>{
  candidateScope=scope;expect(gate.leaseDeadline(scope)).toBe(now===0?1000:1200);
  if(old)expect(gate.leaseDeadline(old.scope)).toBe(1000);
  return f.admit(body,scope,valid);
 },()=>now,()=>{},true);
 old=gate.replace({identity:f.request,body:{}});now=300;
 const next=gate.replace({identity:{...f.request,remainingTtlMs:900},body:{}});
 expect(next.status).toBe('accepted');expect(gate.leaseDeadline(old.scope)).toBeNull();
 expect(gate.leaseDeadline(next.scope)).toBe(1200);expect(gate.apply({scope:candidateScope,body:{}}).status).toBe('rejected');
 now=1200;expect(gate.reconcile()).toBe(true);
});
it.each(['cancel','throw'])('candidate %s never resurrects displayed ownership',kind=>{
 const f=sourcedFixture(),clear=vi.fn();let destructive=false;
 const gate=new PresentationAdmission(()=>f.state,(body,scope,valid)=>{
  if(destructive){if(kind==='cancel'){gate.invalidate();return {status:'rejected'};}throw Error('unknown_mutation');}
  return f.admit(body,scope,valid);
 },()=>0,clear,true);
 const old=gate.replace({identity:f.request,body:{}});destructive=true;
 expect(gate.replace({identity:f.request,body:{}}).status).toBe('rejected');
 expect(gate.leaseDeadline(old.scope)).toBeNull();expect(clear).toHaveBeenCalledOnce();
});
it('invalid candidate input cannot clear valid displayed source, but rewritten source revokes it',()=>{
 const f=sourcedFixture(),clear=vi.fn(),gate=new PresentationAdmission(()=>f.state,f.admit,()=>0,clear,true);
 const old=gate.replace({identity:f.request,body:{}});
 expect(gate.replace({identity:{...f.request,sourceQuote:'invented'},body:{}}).status).toBe('rejected');
 expect(gate.replace({identity:f.request,body:{},annotations:{invalid:true}}).status).toBe('rejected');
 expect(gate.leaseDeadline(old.scope)).toBe(1000);expect(clear).not.toHaveBeenCalled();
 f.state.snapshot.messages[1].text='Edited. Repeat.';
 expect(gate.replace({identity:f.request,body:{}}).status).toBe('rejected');expect(gate.reconcile()).toBe(true);
 expect(clear).toHaveBeenCalledOnce();
});

function stagedFixture(){
 const {state}=fixture();let now=0;const clear=vi.fn();
 Object.assign(state.snapshot,{ownerTurn:'turn',revision:1});Object.assign(state.snapshot.messages[1],{id:'a',text:'First scene. More context.',status:'streaming'});
 const admit=vi.fn((_body,scope,valid)=>valid()?{status:'accepted',epoch:scope.epoch,seq:1,sceneRevision:++state.scene.revision}:{status:'rejected'});
 const gate=new PresentationAdmission(()=>state,admit,()=>now,clear,true);
 const source={...identity,messageId:'a',textPrefix:'First scene.',publicRevision:1,remainingTtlMs:10000,section:0};
 const shot=gate.snapshot(source)!;const old=gate.apply({scope:shot.scope,body:{}});
 return {state,admit,clear,gate,source,old,at:(value:number)=>now=value};
}
it('stages independently without renewing the old lease and swaps atomically',()=>{
 const f=stagedFixture();f.at(2000);
 const next=f.gate.prepare({...f.source,textPrefix:'First scene. More context.',remainingTtlMs:5000})!;
 expect(f.gate.leaseDeadline(f.old.scope)).toBe(10000);expect(f.clear).not.toHaveBeenCalled();
 f.at(6000);const accepted=f.gate.applyPrepared({scope:next.scope,body:{}});
 expect(accepted.status).toBe('accepted');expect(f.gate.leaseDeadline(accepted.scope)).toBe(7000);
 expect(f.gate.leaseDeadline(f.old.scope)).toBeNull();f.at(7000);expect(f.gate.reconcile()).toBe(true);
});
it('rejected candidate keeps old authority; unknown commit fails closed',()=>{
 const f=stagedFixture();const next=f.gate.prepare(f.source)!;
 f.admit.mockImplementationOnce(()=>({status:'rejected',code:'invalid'} as any));
 expect(f.gate.applyPrepared({scope:next.scope,body:{}}).status).toBe('rejected');
 expect(f.gate.leaseDeadline(f.old.scope)).toBe(10000);expect(f.clear).not.toHaveBeenCalled();
 const again=f.gate.prepare(f.source)!;f.admit.mockImplementationOnce(()=>{throw Error('unknown mutation');});
 expect(f.gate.applyPrepared({scope:again.scope,body:{}}).status).toBe('rejected');
 expect(f.gate.leaseDeadline(f.old.scope)).toBeNull();expect(f.clear).toHaveBeenCalledOnce();
});
it.each(['expiry','correction','turn','epoch','revision','cancel'])('prepared candidate cannot survive %s',reason=>{
 const f=stagedFixture();const next=f.gate.prepare(f.source)!;
 if(reason==='expiry')f.at(10000);if(reason==='correction')f.state.snapshot.messages[1].text='Rewritten';
 if(reason==='turn')f.state.snapshot.messages.push({role:'user',turn:'new'});
 if(reason==='epoch')f.state.scene.epoch='new';if(reason==='revision')f.state.scene.revision++;
 if(reason==='cancel')f.gate.invalidate();f.gate.reconcile();
 expect(f.gate.applyPrepared({scope:next.scope,body:{}}).code).toBe('presentation_stale');expect(f.admit).toHaveBeenCalledOnce();
});
it('stale prepared cleanup cannot cancel its replacement; nonstreaming preparation is refused',()=>{
 const f=stagedFixture(),first=f.gate.prepare(f.source)!,second=f.gate.prepare(f.source)!;
 f.gate.cancelPrepared(first.scope);expect(f.gate.applyPrepared({scope:first.scope,body:{}}).code).toBe('presentation_stale');
 expect(f.gate.applyPrepared({scope:second.scope,body:{}}).status).toBe('accepted');expect(f.gate.prepare(identity)).toBeNull();
});
it('old lease retirement never rebases a still pending candidate onto fallback geometry',()=>{
 const f=stagedFixture();f.at(9000);const next=f.gate.prepare({...f.source,remainingTtlMs:10000})!;
 f.at(10000);expect(f.gate.reconcile()).toBe(true);f.state.scene.revision++;
 expect(f.gate.applyPrepared({scope:next.scope,body:{}}).code).toBe('presentation_stale');
});

it('preserves exact prepared deadline when every synchronous clock read advances',()=>{
 const f=stagedFixture();f.at(1000);const shot=f.gate.prepare({...f.source,remainingTtlMs:4000})!;
 let clock=2000;(f.gate as any).now=()=>++clock;
 const receipt=f.gate.applyPrepared({scope:shot.scope,body:{}});expect(receipt.status).toBe('accepted');
 expect(f.gate.leaseDeadline(receipt.scope)).toBe(5000);
});
it('obsolete browser tickets cannot overwrite or cancel newer permits',()=>{
 const f=stagedFixture(),a=f.gate.preparationTicket(),first=f.gate.prepare(f.source,a)!,b=f.gate.preparationTicket(),newer=f.gate.prepare(f.source,b)!;
 expect(f.gate.prepare(f.source,a)).toBeNull();expect(f.gate.prepare(f.source,b)).toBeNull();
 f.gate.cancelPrepared(first.scope);expect(f.gate.applyPrepared({scope:newer.scope,body:{}}).status).toBe('accepted');
});
it('browser intent fences an unseen delayed ticket independently of host clock skew',()=>{
 const f=stagedFixture();f.at(1000);const ticket=f.gate.preparationTicket();
 f.at(1100);f.gate.invalidate();f.at(1200);
 expect(f.gate.prepare(f.source,ticket)).toBeNull();
 expect(f.gate.prepare(f.source,{...ticket,preparationVersion:performance.timeOrigin+1500})).toBeNull();
 expect(f.gate.prepare(f.source,f.gate.preparationTicket())).not.toBeNull();
});

const absoluteBody={type:'parallel',children:[{type:'assemble',parts:[{id:'new',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]}]}]};
function retiredFixture(){
 const f=stagedFixture();f.at(9000);const shot=f.gate.prepare({...f.source,remainingTtlMs:10000})!;
 f.clear.mockImplementation(()=>{const retired={epoch:f.state.scene.epoch,sceneRevision:f.state.scene.revision,seq:1};
  f.state.scene={epoch:'fallback',revision:f.state.scene.revision+1,partIds:['rest']};return {retired,fallback:{...f.state.scene}};});
 f.at(10000);return {...f,shot};
}
it('recovers absolute replacement only across verified own retirement without extending candidate deadline',()=>{
 const f=retiredFixture();expect(f.gate.reconcile()).toBe(true);expect(f.gate.reconcile()).toBe(false);
 expect(f.clear).toHaveBeenCalledOnce();expect(f.gate.leaseDeadline(f.old.scope)).toBeNull();
 f.at(15000);const receipt=f.gate.applyPrepared({scope:f.shot.scope,body:absoluteBody,replacement:true});
 expect(receipt.status).toBe('accepted');expect(receipt.epoch).toBe('fallback');expect(f.gate.leaseDeadline(receipt.scope)).toBe(19000);
 expect(f.gate.leaseDeadline(f.old.scope)).toBeNull();f.at(18999);expect(f.gate.reconcile()).toBe(false);
 f.at(19000);expect(f.gate.reconcile()).toBe(true);expect(f.clear).toHaveBeenCalledTimes(2);
});
it.each(['relative','animate','missing_intent','extra_assemble','perform'])('retirement cannot rebase %s candidate',kind=>{
 const f=retiredFixture();f.gate.reconcile();
 const body=kind==='relative'?{type:'live',program:absoluteBody,configuration:{sceneAppend:true}}:
  kind==='animate'?{type:'wait',durationMs:100}:kind==='extra_assemble'?{...absoluteBody,children:[...absoluteBody.children,...absoluteBody.children]}:
  kind==='perform'?{...absoluteBody,children:[...absoluteBody.children,{type:'perform'}]}:absoluteBody;
 expect(f.gate.applyPrepared({scope:f.shot.scope,body,replacement:kind!=='missing_intent'}).status).toBe('rejected');expect(f.admit).toHaveBeenCalledOnce();
});
it.each(['epoch','revision','cancel','correction','turn','expiry'])('retired candidate rejects intervening %s',reason=>{
 const f=retiredFixture();f.gate.reconcile();
 if(reason==='epoch')f.state.scene.epoch='user';if(reason==='revision')f.state.scene.revision++;
 if(reason==='cancel')f.gate.invalidate();if(reason==='correction')f.state.snapshot.messages[1].text='Changed';
 if(reason==='turn')f.state.snapshot.messages.push({role:'user',turn:'new'});if(reason==='expiry')f.at(19000);
 expect(f.gate.applyPrepared({scope:f.shot.scope,body:absoluteBody,replacement:true}).status).toBe('rejected');expect(f.admit).toHaveBeenCalledOnce();
});
it.each(['noop','throw','wrong_owner','wrong_fallback'])('unknown cleanup %s cannot authorize rebasing',reason=>{
 const f=retiredFixture();f.clear.mockImplementation(()=>{
  if(reason==='throw')throw Error('unknown');if(reason==='noop')return;
  return {retired:{epoch:reason==='wrong_owner'?'other':f.state.scene.epoch,sceneRevision:f.state.scene.revision,seq:1},fallback:{...f.state.scene,revision:reason==='wrong_fallback'?999:f.state.scene.revision}};
 });f.gate.reconcile();
 expect(f.gate.applyPrepared({scope:f.shot.scope,body:absoluteBody,replacement:true}).status).toBe('rejected');expect(f.admit).toHaveBeenCalledOnce();
});
