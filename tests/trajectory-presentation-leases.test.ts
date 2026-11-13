import { afterEach, expect, it, vi } from 'vitest';
import { LiveBody } from '../src/live/body';
import { ReactiveSession } from '../src/core/live/reactive-session';
import { FaceObservations } from '../src/live/observation';
import type { ReactiveRequest } from '../src/core/live/decision-types';
import { faceProgram, faceDefinition } from '../src/core/live/face';
vi.mock('../src/adapters/three-renderer', () => ({ ThreeRenderer: class {
  count = 2000; reducedMotion = false; renderSnapshot = { contextLost: false, frame: 0, signature: 'fixture' };
  quality() {} resize() {} apply() {} dispose() {}
} }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  let now = 1000, wall = 100000, seq = 0, hidden = false;
  vi.spyOn(performance, 'now').mockImplementation(() => now); vi.spyOn(Date, 'now').mockImplementation(() => wall);
  vi.stubGlobal('document', { get hidden() { return hidden; } }); vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {});
  const body = new LiveBody({ getBoundingClientRect: () => ({ width: 800, height: 600 }) } as HTMLCanvasElement, () => {});
  const session = new ReactiveSession({ now: () => now, wallNow: () => wall, epoch: () => body.scheduler.epoch, id: () => `request_${++seq}`,
    canAdmit: () => !hidden && body.canReactive(), canConverse: () => !hidden && body.canConverse(), admit: (compiled, owner) => body.admitReactive(compiled, owner), cancel: (owner, reason) => body.cancelReactive(owner, reason) });
  body.attachReactive(session); session.configure(true); session.enable(true);
  const source = new FaceObservations('fixture');
  const observe = (present = true, event = false, handX = 0.2) => {
    source.update({ landmarks: present ? Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })) : [], scores: {}, matrix: [], durationMs: 0, delegate: 'fixture',
      handObservation: { v: 1, trackingState: present ? 'tracked' : 'lost', coordinateSpace: 'image-normalized', landmarkSchema: 'mediapipe-hand-21', zMeaning: 'wrist-relative-image-width', mirrored: false, sourceWidth: 640, sourceHeight: 480,
        entities: present ? [{ detectionId: 0, handedness: 'Left', confidence: 0.9, landmarks: Array.from({ length: 21 }, () => ({ x: handX, y: 0.5, z: 0 })) }] : [] } }, wall);
    body.observe(source.snapshot); session.observe(source.snapshot, event ? [{ seq: ++seq, type: present ? 'user_arrived' : 'user_left', at: wall }] : []);
  };
  const advance = (ms: number) => { now += ms; wall += ms; };
  const launch = () => { observe(true, true); advance(750); observe(true); const value = session.takeRequest()!; expect(value).not.toBeNull(); expect(session.authorize(value.request.requestId)).toBe(true); return value.request; };
  return { body, session, observe, source, advance, now: () => now, frame: () => (body as any).frame(), hide: () => { hidden = true; }, launch };
}
function decision(request: ReactiveRequest, until = request.deadline) {
  return { schemaVersion: 1, requestId: request.requestId, decisionId: 'decision', mode: 'express', validUntil: until,
    action: { actionId: 'action', body: { type: 'live', program: { type: 'wait', durationMs: 100 }, configuration: { controls: [], poses: [], lifetimeMs: 1000 } } } };
}

const longScene = () => ({ type: 'assemble', durationMs: 100, parts: [{ id: 'traveler', kind: 'ellipsoid', center: [0,0,0], scale: [.3,.3,.1], trajectory: { group: 'traveler', pivot: [0,0,0], keyframes: [
  {atMs:0,translate:[0,0,0],rotate:[0,0,0]}, {atMs:8000,translate:[1,0,0],rotate:[0,0,0]}
] } }] });
it('keeps native observer trajectory through its endpoint before restoring', async () => {
 const f=setup(); f.session.configureNativeConversation(true); const request=f.launch();
 const reply=decision(request); reply.action.body={type:'live',program:longScene(),configuration:{controls:[],poses:[],lifetimeMs:1000}} as any;
 expect((await f.session.deliver(request.requestId,reply))?.reason).toBe('accepted');
 f.frame();
 for(let i=0;i<50;i++){ f.advance(100); f.observe(); f.frame(); }
 const formation=(f.body.scheduler as any).formation;
 expect(formation.partTrajectory[0]).toBeLessThan(8000);expect(f.body.metrics.reactiveOwner).not.toBeNull();
 const cancel=vi.spyOn(f.body.scheduler,'cancel');
 f.advance(200);f.observe();f.frame();
 expect(f.body.metrics.reactiveOwner).not.toBeNull();expect(cancel).not.toHaveBeenCalled();
 expect(formation.parts.some((p:any)=>p.id==='traveler')).toBe(true);
 for(let i=0;i<32;i++){f.advance(100);f.observe();f.frame();}
 expect(f.body.metrics.reactiveOwner).toBeNull();expect(cancel).toHaveBeenCalled();
 f.body.dispose();
});
it('delays MAIN handoff until after its finite trajectory',()=>{
 const f=setup();
 expect(f.body.admit({v:1,epoch:f.body.scheduler.epoch,seq:1,kind:'program',track:'body',policy:'replace',body:{type:'live',program:longScene(),configuration:{controls:[],poses:[],lifetimeMs:1000,observerHandoffMs:10000}}}).status).toBe('accepted');
 f.frame();for(let i=0;i<12;i++){f.advance(100);f.observe();f.frame();}
 const formation=(f.body.scheduler as any).formation;
 expect(formation.partTrajectory[0]).toBeLessThan(8000);expect(f.body.canReactive()).toBe(false);expect(f.body.metrics.userGeometryLocked).toBe(true);
 for(let i=0;i<72;i++){f.advance(100);f.observe();f.frame();}
 expect(f.body.canReactive()).toBe(true);expect(formation.partTrajectory[0]).toBeGreaterThanOrEqual(8000);
 f.body.dispose();
});

it('motion-off revokes permission and resume does not resurrect MAIN handoff',()=>{
 const f=setup(); f.body.admit({v:1,epoch:f.body.scheduler.epoch,seq:1,kind:'program',track:'body',policy:'replace',body:{type:'live',program:longScene(),configuration:{controls:[],poses:[],lifetimeMs:1000,observerHandoffMs:10000}}});
 f.frame();f.advance(200);f.frame();f.body.motion('off');f.frame();
 const formation=(f.body.scheduler as any).formation, elapsed=formation.partTrajectory[0];
 f.advance(10000);f.frame();expect(formation.partTrajectory[0]).toBe(elapsed);
 f.body.motion('normal');f.frame();expect(f.body.canReactive()).toBe(false);expect(f.body.metrics.observerHandoff).toBeNull();f.body.dispose();
});
it.each(['off','rollback','intent'])('still revokes observer trajectory on %s',async reason=>{
 const f=setup();f.session.configureNativeConversation(true);const request=f.launch(),reply=decision(request);
 reply.action.body={type:'live',program:longScene(),configuration:{controls:[],poses:[],lifetimeMs:1000}} as any;
 await f.session.deliver(request.requestId,reply);f.frame();expect(f.body.metrics.reactiveOwner).not.toBeNull();
 if(reason==='off')f.body.motion('off');else if(reason==='intent')f.body.prepareUserMutation();else {f.advance(-1);f.session.tick();}
 expect(f.body.metrics.reactiveOwner).toBeNull();f.body.dispose();
});

function transientScene(f: ReturnType<typeof setup>, transient?: boolean) {
 return f.body.admit({v:1,epoch:f.body.scheduler.epoch,seq:1,kind:'program',track:'body',policy:'replace',body:{type:'live',program:longScene(),configuration:{controls:[],poses:[],lifetimeMs:1000,...(transient===undefined?{}:{transient})}}});
}
function finishPresentation(f: ReturnType<typeof setup>) {
 f.frame();for(let i=0;i<84;i++){f.advance(100);f.observe();f.frame();}
}
it.each([undefined,false])('preserves persistent default when transient=%s', transient=>{
 const f=setup();expect(transientScene(f,transient).status).toBe('accepted');finishPresentation(f);
 expect(f.body.canReactive()).toBe(false);expect(f.body.metrics.userGeometryLocked).toBe(true);f.body.dispose();
});
it('allows successful fresh observer replacement after full transient presentation without time expiry',async()=>{
 const f=setup();expect(transientScene(f,true).status).toBe('accepted');f.frame();f.advance(1200);f.observe();f.frame();expect(f.body.canReactive()).toBe(false);
 for(let i=0;i<700;i++){f.advance(100);f.observe();f.frame();}
 expect(f.body.canReactive()).toBe(true);expect(f.body.scheduler.state.particleParts?.some(p=>p.id==='traveler')).toBe(true);
 const request=f.launch();expect((await f.session.deliver(request.requestId,decision(request)))?.reason).toBe('accepted');
 expect(f.body.metrics.transientScene).toBeNull();f.body.dispose();
});
it('preserves scene intent across source loss but rejects old decision and accepts fresh reconnect',async()=>{
 const f=setup();transientScene(f,true);finishPresentation(f);const old=f.launch();
 f.source.status('stopped',Date.now());f.body.observe(f.source.snapshot);f.session.observe(f.source.snapshot,[]);
 expect(f.body.metrics.transientScene).not.toBeNull();expect((await f.session.deliver(old.requestId,decision(old)))?.reason).toBe('revoked');
 f.advance(16000);const fresh=f.launch();expect((await f.session.deliver(fresh.requestId,decision(fresh)))?.reason).toBe('accepted');f.body.dispose();
});
it('keeps transient permission after failed observer validation',()=>{
 const f=setup();transientScene(f,true);finishPresentation(f);
 expect(()=>f.body.admitReactive({program:{kind:'program',epoch:f.body.scheduler.epoch},configuration:{transient:true}} as any,{} as any)).toThrow('reactive_delegation_forbidden');
 expect(f.body.canReactive()).toBe(true);expect(f.body.metrics.transientScene).not.toBeNull();f.body.dispose();
});
it.each(['intent','invalid-main','off','reset'])('revokes transient scene permission on %s', reason=>{
 const f=setup();transientScene(f,true);finishPresentation(f);
 if(reason==='intent')f.body.prepareUserMutation();else if(reason==='invalid-main')f.body.admit({bad:true});else if(reason==='off'){f.body.motion('off');f.body.motion('normal');}else f.body.epoch('next',true);
 expect(f.body.metrics.transientScene).toBeNull();f.body.dispose();
});
it('keeps MAIN transient opt-in compact and out of all observer response schemas',async()=>{
 const {composeExpression,compositionSchema}=await import(new URL('../integrations/compose-expression.mjs',import.meta.url).href);
 const {expressionResponseSchema}=await import(new URL('../integrations/expression-response.mjs',import.meta.url).href);
 const input={parts:longScene().parts};expect(Buffer.byteLength(JSON.stringify(compositionSchema))).toBeLessThan(5000);
 expect(composeExpression(input).body.type).toBe('parallel');expect(composeExpression({...input,transient:false}).body.type).toBe('parallel');
 expect(composeExpression({...input,transient:true}).body.configuration.transient).toBe(true);
 expect(JSON.stringify(expressionResponseSchema)).not.toContain('"transient"');
});
it.each([true,false])('rejects observer configuration transient=%s at runtime',transient=>{
 const f=setup();expect(()=>f.body.admitReactive({configuration:{transient}} as any,{} as any)).toThrow('reactive_delegation_forbidden');f.body.dispose();
});

it('retains scene intent when an actual observer response is invalid',async()=>{
 const f=setup();transientScene(f,true);finishPresentation(f);const request=f.launch();
 const result=await f.session.deliver(request.requestId,{bad:true});expect(result?.reason).not.toBe('accepted');
 expect(f.body.metrics.transientScene).not.toBeNull();expect(f.body.metrics.userGeometryLocked).toBe(true);f.body.dispose();
});
