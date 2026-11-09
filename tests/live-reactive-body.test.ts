import { afterEach, expect, it, vi } from 'vitest';
import { LiveBody } from '../src/live/body';
import { ReactiveSession } from '../src/core/live/reactive-session';
import { FaceObservations } from '../src/live/observation';
import type { ReactiveRequest } from '../src/core/live/decision-types';
import { faceProgram } from '../src/core/live/face';
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
    canAdmit: () => !hidden && body.canReactive(), admit: (compiled, owner) => body.admitReactive(compiled, owner), cancel: (owner, reason) => body.cancelReactive(owner, reason) });
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
it('rejects late departure, camera-off, epoch/reset and user intent before admission', async () => {
  for (const cancel of [(f: ReturnType<typeof setup>) => f.observe(false, true), (f: ReturnType<typeof setup>) => { f.source.status('stopped', Date.now()); f.session.observe(f.source.snapshot, []); },
    (f: ReturnType<typeof setup>) => f.body.epoch('next_epoch'), (f: ReturnType<typeof setup>) => f.session.userIntent()]) {
    const f = setup(), request = f.launch(); cancel(f);
    expect((await f.session.deliver(request.requestId, decision(request)))?.reason).toBe('revoked');
    expect(f.body.metrics.reactiveOwner).toBeNull(); expect(f.body.scheduler.queueDepth).toBe(0); f.body.dispose();
  }
});
it('accepts same-track frames and revokes expired controls before any scheduler advance', async () => {
  const f = setup(), request = f.launch();
  f.advance(20); f.observe(true, false, 0.21);
  expect((await f.session.deliver(request.requestId, decision(request, f.now() + 50)))?.reason).toBe('accepted');
  expect(f.body.metrics.reactiveOwner).toBe('action');
  const cancel = vi.spyOn(f.body.scheduler, 'cancel'), tick = vi.spyOn(f.body.scheduler, 'tick');
  f.advance(51); f.frame();
  expect(f.body.metrics.reactiveOwner).toBeNull(); expect(f.session.status().owner).toBeNull();
  expect(cancel.mock.calls[0]).toEqual([request.epoch, false]);
  expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(tick.mock.invocationCallOrder[0]);
  f.body.dispose();
});
it('gives external user programs priority and keeps their configuration lease after IR completion', async () => {
  const f = setup(), request = f.launch(); await f.session.deliver(request.requestId, decision(request));
  const result = f.body.admit({ v: 1, epoch: request.epoch, seq: 42, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'live', program: { type: 'wait', durationMs: 10 }, configuration: { controls: [], poses: [], lifetimeMs: 1000 } } });
  expect(result.status).toBe('accepted'); expect(f.body.metrics.reactiveOwner).toBeNull();
  f.advance(20); f.frame(); expect(f.body.scheduler.busy).toBe(false); expect(f.body.canReactive()).toBe(false);
  expect(f.body.admit({ v: 1, epoch: request.epoch, seq: 43, kind: 'program', track: 'body', policy: 'replace', body: { type: 'wait', durationMs: 1 } }).status).toBe('accepted');
  f.advance(2); f.frame(); expect(f.body.canReactive()).toBe(false);
  const cancellations = vi.spyOn(f.body.scheduler, 'cancel'); f.advance(100); f.session.tick(); expect(cancellations).not.toHaveBeenCalled();
  f.advance(900); expect(f.body.canReactive()).toBe(true); f.body.dispose();
});
it('ticks revocation even while hidden or motion is off and rejects non-program reactive admission', () => {
  const f = setup(), tick = vi.spyOn(f.session, 'tick'), scheduler = vi.spyOn(f.body.scheduler, 'tick');
  f.hide(); f.frame(); expect(tick).toHaveBeenCalled(); expect(scheduler).not.toHaveBeenCalled();
  f.body.motion('off'); tick.mockClear(); f.frame(); expect(tick).toHaveBeenCalled();
  expect(() => f.body.admitReactive({ program: { kind: 'define' } } as any, {} as any)).toThrow('reactive_admission_rejected'); f.body.dispose();
});
it('preserves user geometry after animation completes until an explicit return to the avatar', () => {
  const f = setup(), epoch = f.body.scheduler.epoch;
  expect(f.body.admit({ v: 1, epoch, seq: 1, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'morph', target: 'sphere', durationMs: 100 } }).status).toBe('accepted');
  f.advance(1000); f.frame();
  expect(f.body.scheduler.busy).toBe(false); expect(f.body.metrics.userGeometryLocked).toBe(true); expect(f.body.canReactive()).toBe(false);
  expect(f.body.admit({ v: 1, epoch, seq: 2, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'live', program: faceProgram(100), configuration: { controls: [], poses: [], lifetimeMs: 60000 } } }).status).toBe('accepted');
  f.advance(101); f.frame();
  expect(f.body.metrics.userGeometryLocked).toBe(false); expect(f.body.canReactive()).toBe(true);
  f.body.dispose();
});
it('forwards only Native lifecycle receipts despite local epoch and sequence collisions', async () => {
  const f = setup(), events: { status: string; seq: number }[] = [];
  f.body.feedback = event => events.push(event);
  const native = (seq: number) => f.body.admit({ v: 1, epoch: f.body.scheduler.epoch, seq, kind: 'program', track: 'body', policy: 'replace', body: { type: 'wait', durationMs: 10 } });
  expect(native(1).status).toBe('accepted'); f.advance(11); f.frame();
  expect(events).toEqual([expect.objectContaining({ seq: 1, status: 'applied' }), expect.objectContaining({ seq: 1, status: 'completed' })]);
  events.length = 0;
  const request = f.launch();
  expect((await f.session.deliver(request.requestId, decision(request, f.now() + 200)))?.reason).toBe('accepted');
  f.advance(101); f.frame();
  expect(events).toEqual([]);
  const local = f.body.trace.snapshot().events.filter(event => event.origin === 'reactive');
  expect(local.filter(event => ['applied', 'completed'].includes(event.phase))).toEqual([
    expect.objectContaining({ seq: 1, requestId: request.requestId, decisionId: 'decision', actionId: 'action', phase: 'applied' }),
    expect.objectContaining({ seq: 1, phase: 'completed' })]);
  f.advance(100); f.frame(); expect(f.body.metrics.reactiveOwner).toBeNull(); expect(events).toEqual([]);
  expect(native(2).status).toBe('accepted'); f.advance(11); f.frame();
  expect(events.map(event => [event.seq, event.status])).toEqual([[2, 'applied'], [2, 'completed']]); f.body.dispose();
});
it('isolates reactive cancellation receipts after the current owner has been cleared', async () => {
  const f = setup(), request = f.launch(), events: unknown[] = [];
  f.body.feedback = event => events.push(event);
  await f.session.deliver(request.requestId, decision(request));
  f.session.userIntent();
  expect(f.body.metrics.reactiveOwner).toBeNull(); expect(events).toEqual([]);
  expect(f.body.trace.snapshot().events).toContainEqual(expect.objectContaining({ origin: 'reactive', requestId: request.requestId, phase: 'cancelled' }));
  f.body.dispose();
});
it('validates reactive part references before cancelling or mutating the ambient scene', async () => {
  const f = setup(), request = f.launch(), cancel = vi.spyOn(f.body.scheduler, 'cancel'), release = vi.spyOn(f.body.controls, 'release');
  const before = JSON.stringify(f.body.scheduler.state), events: unknown[] = [];
  f.body.feedback = event => events.push(event);
  const value = decision(request);
  value.action.body.configuration.controls.push({ type: 'bind', id: 'missing', signal: 'agent.output', target: { part: 'missing', prop: 'x' }, gain: 1, offset: 0, clamp: [-0.4, 0.4], smoothMs: 40 } as never);
  expect((await f.session.deliver(request.requestId, value))?.reason).toBe('admission_failed');
  expect(cancel).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  expect(f.body.metrics.reactiveOwner).toBeNull(); expect(JSON.stringify(f.body.scheduler.state)).toBe(before); expect(events).toEqual([]);
  f.body.dispose();
});
