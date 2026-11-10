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
  expect(f.body.scheduler.busy).toBe(false); expect(f.body.metrics.userGeometryLocked).toBe(true); expect(f.body.canReactive()).toBe(false); expect(f.body.canConverse()).toBe(true);
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
it('rejects nonfinite perception before rendering and recovers on the next valid frame', () => {
  const f = setup(), renderer = vi.spyOn(f.body.renderer, 'apply');
  const sample = { landmarks: Array.from({ length: 478 }, () => ({ x: NaN, y: 0.5, z: 0 })), scores: {}, matrix: [], durationMs: 0, delegate: 'fixture' };
  f.source.update(sample, Date.now());
  expect(Number.isNaN(f.source.snapshot.user.position!.x)).toBe(true);
  f.body.observe(f.source.snapshot); f.session.observe(f.source.snapshot, []);
  expect(f.session.status().sourceValid).toBe(false);
  f.advance(16); f.frame();
  const bad = renderer.mock.calls.at(-1)![0] as any;
  const invalid = (state: any) => state.liveMatrices.flatMap((m: Float64Array | undefined) => m ? [...m] : []).filter((n: number) => !Number.isFinite(n)).length;
  expect(invalid(bad)).toBe(0);
  f.source.update({ ...sample, landmarks: sample.landmarks.map(() => ({ x: 0.5, y: 0.5, z: 0 })) }, Date.now());
  f.body.observe(f.source.snapshot); f.session.observe(f.source.snapshot, []); f.advance(16); f.frame();
  expect(f.session.status().sourceValid).toBe(true);
  expect(invalid(renderer.mock.calls.at(-1)![0])).toBe(0);
  f.body.dispose();
});
it('reports a native live pose cancelled when Stop changes epoch after 470ms, not completed at wait-zero', () => {
  const f = setup(), events: { seq: number; status: string }[] = [];
  f.body.feedback = event => events.push(event);
  f.body.epoch('11111111-1111-4111-8111-111111111111');
  const epoch = f.body.scheduler.epoch;
  expect(f.body.admit({ v: 1, epoch, seq: 99, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'live', program: null, configuration: { controls: [], lifetimeMs: 8000,
      poses: [{ type: 'pose', target: { part: 'body', prop: 'x' }, value: 0.1, durationMs: 8000 }] } } }).status).toBe('accepted');
  f.frame(); f.advance(470); f.frame();
  expect(events.filter(event => event.seq === 99).map(event => event.status)).toEqual(['applied']);
  f.body.epoch('stopped'); f.advance(9000); f.frame();
  expect(events.filter(event => event.seq === 99).map(event => event.status)).toEqual(['applied', 'cancelled']);
  expect(f.body.metrics.diagnostics.events.some(event => event.seq === 99 && event.epoch === epoch && event.phase === 'cancelled')).toBe(true);
  f.body.dispose();
});
it('follows valid hand position locally with semantics disabled, fades on loss, and yields to a user creation', () => {
  const f = setup(), rendered = vi.spyOn(f.body.renderer, 'apply'); f.session.configure(false);
  const x = () => (rendered.mock.calls.at(-1)?.[0] as any)?.liveMatrices?.[0]?.[3] ?? 0;
  for (let i = 0; i < 45; i++) { f.observe(true, false, 0.2); f.advance(16); f.frame(); }
  expect(x()).toBeGreaterThan(0.07); expect(x()).toBeLessThanOrEqual(0.16);
  f.source.status('stopped', Date.now()); f.body.observe(f.source.snapshot);
  for (let i = 0; i < 90; i++) { f.advance(16); f.frame(); }
  expect(Math.abs(x())).toBeLessThan(0.01);
  expect((rendered.mock.calls.at(-1)?.[0] as any)?.liveMatrices?.[0]).toBeUndefined();
  expect(f.body.admit({ v: 1, epoch: f.body.scheduler.epoch, seq: 1, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'assemble', durationMs: 100, parts: [{ id: 'owned-scene', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.2, 0.2, 0.1] }] } }).status).toBe('accepted');
  for (let i = 0; i < 45; i++) { f.observe(true, false, 0.2); f.advance(16); f.frame(); }
  expect(Math.abs(x())).toBeLessThan(0.001); expect(f.body.metrics.userGeometryLocked).toBe(true);
  expect(f.body.metrics.reactiveOwner).toBeNull(); f.body.dispose();
});
it('keeps the brighter crisp Live baseline after idle release and still accepts an authored dimmer style', () => {
  const f = setup();
  for (let i = 0; i < 80; i++) { f.advance(16); f.frame(); }
  expect(f.body.scheduler.state.brightness).toBeCloseTo(0.95);
  expect(f.body.scheduler.state.pointSize).toBeCloseTo(2.2);
  expect(f.body.scheduler.state.dispersion).toBe(0);
  expect(f.body.admit({ v: 1, epoch: f.body.scheduler.epoch, seq: 1, kind: 'state',
    body: { brightness: 0.3, pointSize: 1.5, durationMs: 100 } }).status).toBe('accepted');
  for (let i = 0; i < 80; i++) { f.advance(16); f.frame(); }
  expect(f.body.scheduler.state.brightness).toBeCloseTo(0.3);
  expect(f.body.scheduler.state.pointSize).toBeCloseTo(1.5); f.body.dispose();
});
it('glances during work with no semantic provider, then revokes on Native intent and cached epoch input', () => {
  const f = setup(), rendered = vi.spyOn(f.body.renderer, 'apply'); f.session.configure(false); f.body.activity('working');
  for (let i = 0; i < 25; i++) { f.observe(true, false, 0.2); f.advance(16); f.frame(); }
  const state = () => rendered.mock.calls.at(-1)![0] as any;
  const pupilX = () => state().liveMatrices[state().particleParts.findIndex((p: any) => p.id === 'pupil_left') + 1]?.[3] ?? 0;
  expect(f.body.metrics.visualAttention.active).not.toBeNull(); expect(pupilX()).toBeGreaterThan(0.01);
  const started = f.body.metrics.visualAttention.history.filter(e => e.status === 'started').length;
  f.body.prepareUserMutation(); f.frame(); expect(f.body.metrics.visualAttention.active).toBeNull();
  expect(Math.abs(pupilX())).toBeLessThan(1e-8);
  for (let i = 0; i < 40; i++) { f.observe(true, false, 0.2); f.advance(16); f.frame(); }
  expect(f.body.metrics.visualAttention.history.filter(e => e.status === 'started')).toHaveLength(started);
  f.body.epoch('new-epoch'); f.body.observe(f.source.snapshot); f.frame();
  expect(f.body.metrics.visualAttention.active).toBeNull(); f.body.dispose();
});
it('keeps geometric gaze below an explicit canonical-face user lease', () => {
  const f = setup(); f.session.configure(false);
  expect(f.body.admit({ v: 1, epoch: f.body.scheduler.epoch, seq: 1, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'live', program: null, configuration: { controls: [], lifetimeMs: 1000,
      poses: [{ type: 'pose', target: { part: 'pupil_left', prop: 'x' }, value: 0.2, durationMs: 1000 }] } } }).status).toBe('accepted');
  for (let i = 0; i < 30; i++) { f.observe(true, false, 0.2); f.advance(16); f.frame(); }
  expect(f.body.metrics.userGeometryLocked).toBe(false); expect(f.body.metrics.visualAttention.active).toBeNull();
  expect(f.body.metrics.visualAttention.reason).toBe('owned'); f.body.dispose();
});
it('discards movement observed only while motion is off instead of queueing a glance for resume', () => {
  const f = setup(); f.session.configure(false); f.body.activity('working');
  for (let i = 0; i < 25; i++) { f.observe(true, false, 0.2); f.advance(16); f.frame(); }
  const started = f.body.metrics.visualAttention.history.filter(e => e.status === 'started').length;
  expect(started).toBe(1); f.body.motion('off');
  for (let i = 0; i < 100; i++) { f.observe(true, false, 0.8); f.advance(100); f.frame(); }
  f.body.motion('normal');
  for (let i = 0; i < 40; i++) { f.observe(true, false, 0.8); f.advance(16); f.frame(); }
  expect(f.body.metrics.visualAttention.active).toBeNull();
  expect(f.body.metrics.visualAttention.history.filter(e => e.status === 'started')).toHaveLength(started);
  f.body.dispose();
});

it('keeps a complete face component living inside an agent-owned compound assembly', () => {
  const f = setup(), rendered = vi.spyOn(f.body.renderer, 'apply'); f.session.configure(false);
  const overlay = { id: 'agent_mark', kind: 'ellipsoid', center: [1.7, 1.6, 0.3], scale: [0.12, 0.12, 0.05] };
  const parts = [...structuredClone(faceDefinition.parts), overlay];
  expect(f.body.admit({ v: 1, epoch: f.body.scheduler.epoch, seq: 1, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'assemble', parts, durationMs: 100 } }).status).toBe('accepted');
  f.body.activity('replying'); f.body.output = 0.8;
  for (let i = 0; i < 80; i++) { f.advance(16); f.frame(); }
  const state = () => rendered.mock.calls.at(-1)![0] as any;
  const matrix = (id: string) => state().liveMatrices[state().particleParts.findIndex((p: any) => p.id === id) + 1];
  expect(matrix('mouth')?.[5] ?? 1).toBeGreaterThan(1.5);
  expect(f.body.userSceneOwned).toBe(true); expect(f.body.canReactive()).toBe(false);
  expect(state().particleParts.find((p: any) => p.id === overlay.id)).toEqual(overlay);
  expect(matrix(overlay.id)).toBeUndefined(); expect(f.body.metrics.visualAttention.active).toBeNull();
  expect(f.body.admit({ v: 1, epoch: f.body.scheduler.epoch, seq: 2, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'live', program: null, configuration: { controls: [], poses: [
      { type: 'pose', target: { part: 'mouth', prop: 'scaleY' }, value: 0.4, durationMs: 1000, attackMs: 100, releaseMs: 100 }], lifetimeMs: 2000 } } }).status).toBe('accepted');
  for (let i = 0; i < 45; i++) { f.advance(16); f.frame(); }
  expect(matrix('mouth')?.[5]).toBeCloseTo(0.4, 1); expect(f.body.userSceneOwned).toBe(true); f.body.dispose();
});

it('permits conversation only after a protected user form is idle and keeps off mode blocked', () => {
  const f = setup(), epoch = f.body.scheduler.epoch;
  f.body.admit({ v: 1, epoch, seq: 1, kind: 'program', track: 'body', policy: 'replace', body: { type: 'morph', target: 'sphere', durationMs: 100 } });
  expect(f.body.canConverse()).toBe(false); f.advance(1000); f.frame();
  expect(f.body.canReactive()).toBe(false); expect(f.body.canConverse()).toBe(true);
  f.body.motion('off'); expect(f.body.canConverse()).toBe(false); f.body.dispose();
});

function disposable(f: ReturnType<typeof setup>, ms = 30000, seq = 100) {
  return f.body.admit({ v: 1, epoch: f.body.scheduler.epoch, seq, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'live', program: { type: 'morph', target: 'sphere', durationMs: 100 },
      configuration: { controls: [], poses: [], lifetimeMs: 1000, observerHandoffMs: ms } } });
}
it('transfers only explicitly disposable geometry after its lease, without restoring the old scene', async () => {
  const f = setup(); expect(disposable(f).status).toBe('accepted');
  f.source.status('absent', Date.now()); f.body.observe(f.source.snapshot); expect(f.body.metrics.observerHandoff).not.toBeNull();
  expect(f.body.canReactive()).toBe(false); f.advance(1001); f.frame(); expect(f.body.canReactive()).toBe(true);
  expect(f.body.metrics.userGeometryLocked).toBe(true);
  const request = f.launch(); expect((await f.session.deliver(request.requestId, decision(request)))?.reason).toBe('accepted');
  expect(f.body.metrics.userGeometryLocked).toBe(false); expect(f.body.metrics.observerHandoff).toBeNull();
  f.advance(5001); f.frame(); expect(f.body.metrics.reactiveOwner).toBeNull();
  expect(f.body.metrics.scene).toBe('face'); f.body.dispose();
});
it('expires or revokes unused handoff on intent, reset, source loss and motion off', () => {
  const changes = [(f: ReturnType<typeof setup>) => f.body.prepareUserMutation(),
    (f: ReturnType<typeof setup>) => f.body.epoch('replacement'), (f: ReturnType<typeof setup>) => f.body.motion('off'),
    (f: ReturnType<typeof setup>) => { f.source.status('stopped', Date.now()); f.body.observe(f.source.snapshot); },
    (f: ReturnType<typeof setup>) => f.body.revokeObserverHandoff(),
    (f: ReturnType<typeof setup>) => { f.observe(); f.body.observe({ ...f.source.snapshot, sessionId: 'new_source' }); }];
  for (const change of changes) {
    const f = setup(); expect(disposable(f).status).toBe('accepted'); f.advance(1001); f.frame();
    expect(f.body.canReactive()).toBe(true); change(f); expect(f.body.metrics.observerHandoff).toBeNull();
    f.body.dispose();
  }
  const f = setup(); expect(disposable(f, 1000).status).toBe('accepted');
  f.advance(2000); f.frame(); expect(f.body.canReactive()).toBe(false); expect(f.body.metrics.userGeometryLocked).toBe(true); f.body.dispose();
});
it('rejects reactive self-delegation before mutation and keeps valid MAIN handoff on invalid admission', () => {
  const f = setup(); expect(disposable(f).status).toBe('accepted'); f.advance(1001); f.frame();
  const compiled = { program: { kind: 'program', epoch: f.body.scheduler.epoch, ops: [], duration: 0 },
    configuration: { controls: [], poses: [], lifetimeMs: 1000, observerHandoffMs: 3000 } } as any;
  const before = f.body.metrics.observerHandoff;
  expect(() => f.body.admitReactive(compiled, {} as any)).toThrow('reactive_delegation_forbidden');
  expect(f.body.metrics.observerHandoff).toEqual(before); expect(f.body.metrics.userGeometryLocked).toBe(true);
  expect(disposable(f, NaN, 101).status).toBe('rejected'); expect(f.body.metrics.observerHandoff).toBeNull(); f.body.dispose();
});

it('rejects a delayed decision at exact handoff expiry and never reuses a superseded grant', async () => {
  const f = setup(); expect(disposable(f, 1000).status).toBe('accepted'); f.advance(1001); f.frame();
  const request = f.launch(); f.advance(249); f.observe();
  const result = await f.session.deliver(request.requestId, decision(request));
  expect(result?.reason).toBe('admission_failed'); expect(f.body.metrics.userGeometryLocked).toBe(true);
  expect(f.body.metrics.reactiveOwner).toBeNull();
  expect(disposable(f, 30000, 101).status).toBe('accepted'); f.advance(1001); f.frame();
  expect(f.body.canReactive()).toBe(true);
  expect(f.body.admit({ v: 1, epoch: f.body.scheduler.epoch, seq: 102, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'wait', durationMs: 1 } }).status).toBe('accepted');
  expect(f.body.metrics.observerHandoff).toBeNull(); f.advance(2); f.frame(); expect(f.body.canReactive()).toBe(false);
  expect(await f.session.deliver(request.requestId, decision(request))).toBeNull(); f.body.dispose();
});
