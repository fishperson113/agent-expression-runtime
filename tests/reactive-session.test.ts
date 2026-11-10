import { expect, it } from 'vitest';
import { ReactiveSession } from '../src/core/live/reactive-session';
import { unavailableUser, type Observation } from '../src/core/live/types';
import type { ReactiveRequest } from '../src/core/live/decision-types';

function fixture(converse?: () => boolean) {
  let now = 1000, wall = 10000, seq = 0, event = 0, id = 0, epoch = 'epoch', canAdmit = true;
  const admitted: unknown[] = [], cancelled: unknown[] = [];
  const session = new ReactiveSession({ now: () => now, wallNow: () => wall, epoch: () => epoch, id: () => `r${++id}`,
    canAdmit: () => canAdmit, canConverse: converse, admit: (...args) => admitted.push(args), cancel: (...args) => cancelled.push(args) });
  const observe = (present = true, type?: 'user_arrived' | 'user_left' | 'expression_changed' | 'looked_away' | 'looked_back', tracks: string[] = []) => {
    const snapshot: Observation = { v: 1, sessionId: 's', seq: ++seq, capturedAt: wall, camera: present ? 'tracking' : 'absent',
      turn: 'idle', summary: '', user: { ...unavailableUser(), present } };
    if (tracks.length) snapshot.hands = { v: 1, trackingState: 'tracked', coordinateSpace: 'image-normalized', landmarkSchema: 'mediapipe-hand-21',
      zMeaning: 'wrist-relative-image-width', mirrored: false, sourceWidth: 640, sourceHeight: 480, primaryTrackId: tracks[0],
      entities: tracks.map((trackId, detectionId) => ({ trackId, detectionId, handedness: 'Unknown', confidence: 0.9,
        landmarks: Array.from({ length: 21 }, () => ({ x: (seq % 10) / 10, y: 0.5, z: 0 })) })) };
    session.observe(snapshot, type ? [{ seq: ++event, type, at: wall }] : []); return snapshot;
  };
  const advance = (ms: number) => { now += ms; wall += ms; };
  session.configure(true); session.enable(true); observe();
  return { session, admitted, cancelled, observe, advance, now: () => now, wall: () => wall,
    epoch: (value: string) => { epoch = value; }, block: () => { canAdmit = false; },
    rollback: () => { now -= 10; }, launch: (tracks: string[] = [], authorized = true) => { observe(true, 'user_arrived', tracks); advance(750); observe(true, undefined, tracks); const next = session.takeRequest()!; if (authorized) expect(session.authorize(next.request.requestId)).toBe(true); return next; } };
}
const express = (request: ReactiveRequest) => ({ schemaVersion: 1, requestId: request.requestId,
  decisionId: `d${request.requestId}`, mode: 'express', validUntil: request.deadline, action: { actionId: `a${request.requestId}`, body: { type: 'wait', durationMs: 100 } } });
const observeDecision = (request: ReactiveRequest) => ({ ...express(request), mode: 'observe', action: null });
it('blocks arrival results after departure and after departure-return while retaining transport', async () => {
  for (const returns of [false, true]) {
    const f = fixture(), { request } = f.launch(); f.advance(50); f.observe(false, 'user_left');
    if (returns) { f.advance(50); f.observe(true, 'user_arrived'); }
    expect(f.session.status().transport).toBe(request.requestId); expect(f.session.takeRequest()).toBeNull();
    expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('revoked');
    expect(f.admitted).toEqual([]); expect(await f.session.deliver(request.requestId, express(request))).toBeNull();
  }
});
it('accepts compatible frames of the same tracks then cancels only its lease on track loss', async () => {
  const f = fixture(), { request, observationWindow } = f.launch(['hand_1_1', 'hand_1_2']);
  expect(request.requiredTrackIds).toEqual(['hand_1_1', 'hand_1_2']); expect(request.presenceRevision).toBeDefined();
  expect(Object.isFrozen(observationWindow.observations[0].user)).toBe(true);
  for (let i = 0; i < 20; i++) { f.advance(20); f.observe(true, undefined, ['hand_1_1', 'hand_1_2']); }
  expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('accepted'); expect(f.admitted).toHaveLength(1);
  f.advance(20); f.observe(true, undefined, ['hand_1_1']); expect(f.cancelled).toHaveLength(1);
  f.session.tick(); expect(f.cancelled).toHaveLength(1);
});
it('revokes after user intent, reset, consent off, epoch change and final admission barrier', async () => {
  for (const revoke of [(f: ReturnType<typeof fixture>) => f.session.userIntent(), (f: ReturnType<typeof fixture>) => f.session.reset(),
    (f: ReturnType<typeof fixture>) => f.session.enable(false), (f: ReturnType<typeof fixture>) => { f.epoch('new_epoch'); f.session.tick(); }]) {
    const f = fixture(), { request } = f.launch(); revoke(f);
    expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('revoked'); expect(f.admitted).toEqual([]);
  }
  const f = fixture(), { request } = f.launch(); f.block();
  expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('admission_failed'); expect(f.admitted).toEqual([]);
});
it('retains expired/revoked transport and fails closed after unknown outcomes without automatic retries', async () => {
  const f = fixture(), { request } = f.launch();
  for (let i = 0; i < 6; i++) { f.advance(1000); f.observe(); }
  f.session.tick(); expect(f.session.status().transport).toBe(request.requestId); expect(f.session.takeRequest()).toBeNull();
  expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('revoked'); expect(f.admitted).toEqual([]);
  const g = fixture(), active = g.launch().request;
  expect((await g.session.fail(active.requestId))?.reason).toBe('transport_unknown'); expect(g.session.status().uncertain).toBe(true);
  g.advance(16000); g.observe(true, 'expression_changed'); g.advance(750); g.observe(); expect(g.session.takeRequest()).toBeNull();
});
it('coalesces a finite burst with newest lineage and bounds history while enforcing consent/user busy', () => {
  const f = fixture(); f.observe(true, 'expression_changed');
  for (let i = 0; i < 100; i++) { f.advance(7); f.observe(true, 'expression_changed'); }
  expect(f.session.takeRequest()).toBeNull(); f.advance(50); f.observe();
  f.session.setUserBusy(true); expect(f.session.takeRequest()).toBeNull(); f.session.setUserBusy(false);
  f.observe(true, 'expression_changed'); f.advance(750); f.observe();
  const next = f.session.takeRequest()!; expect(next.observationWindow.observations).toHaveLength(4); expect(next.observationWindow.events).toHaveLength(1);
  expect(next.observationWindow.events[0].id).toBe(102); expect(f.session.takeRequest()).toBeNull();
  const unavailable = fixture(); unavailable.session.configure(false); unavailable.session.enable(true);
  unavailable.observe(true, 'user_arrived'); unavailable.advance(750); unavailable.observe(); expect(unavailable.session.takeRequest()).toBeNull();
});
it('counts all dispatches in the rolling minute including observe and failed parsing', async () => {
  const f = fixture();
  for (let turn = 0; turn < 4; turn++) {
    if (turn) { f.advance(14250); f.observe(); }
    f.observe(true, 'expression_changed'); f.advance(750); f.observe(); const next = f.session.takeRequest()!;
    expect(next).toBeTruthy(); expect(f.session.authorize(next.request.requestId)).toBe(true); await f.session.deliver(next.request.requestId, turn === 1 ? 'invalid text' : observeDecision(next.request));
  }
  f.advance(14249); f.observe(true, 'expression_changed'); f.advance(750); f.observe(); expect(f.session.takeRequest()).toBeNull();
  f.advance(1); f.observe(); expect(f.session.takeRequest()).not.toBeNull();
});
it('invalidates capture gaps, expired input and monotonic clock rollback even without a prior tick', async () => {
  for (const action of [(f: ReturnType<typeof fixture>) => { f.advance(1600); f.observe(); },
    (f: ReturnType<typeof fixture>) => { f.advance(1600); }, (f: ReturnType<typeof fixture>) => { f.rollback(); f.session.tick(); }]) {
    const f = fixture(), { request } = f.launch(); action(f);
    expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('revoked'); expect(f.admitted).toEqual([]);
  }
});
it('revokes required-track loss even if the track returns before the response', async () => {
  const f = fixture(), { request } = f.launch(['hand_1_1']);
  f.advance(20); f.observe(true); f.advance(20); f.observe(true, undefined, ['hand_1_1']);
  expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('revoked'); expect(f.admitted).toEqual([]);
});
it('revokes camera unavailability and source session changes before delayed admission', async () => {
  for (const change of ['camera', 'session', 'capture_rollback']) {
    const f = fixture(), { request } = f.launch(); const last = f.observe();
    const next = { ...last, seq: last.seq + 1 };
    if (change === 'camera') next.camera = 'stopped';
    if (change === 'session') next.sessionId = 'another_session';
    if (change === 'capture_rollback') next.capturedAt--;
    f.session.observe(next, []);
    expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('revoked'); expect(f.admitted).toEqual([]);
  }
});
it('fails closed at the lifetime receipt limit and never reopens it with reset', async () => {
  const f = fixture();
  for (let turn = 0; turn < 256; turn++) {
    if (turn) { f.advance(14250); f.observe(); }
    f.observe(true, 'expression_changed'); f.advance(750); f.observe(); const next = f.session.takeRequest()!;
    expect(next).toBeTruthy(); expect(f.session.authorize(next.request.requestId)).toBe(true); expect((await f.session.deliver(next.request.requestId, observeDecision(next.request)))?.reason).toBe('observed');
  }
  f.session.reset(); f.advance(15000); f.observe(true, 'expression_changed'); f.advance(750); f.observe();
  expect(f.session.status().dispatches).toBe(256); expect(f.session.takeRequest()).toBeNull();
});

it('authorizes dispatch once and rejects preflight after revocation without a provider-side effect', async () => {
  const before = fixture(), blocked = before.launch([], false).request;
  before.advance(10); before.observe(false, 'user_left');
  let dispatches = 0;
  if (before.session.authorize(blocked.requestId)) dispatches++;
  expect(dispatches).toBe(0); expect(before.session.status().transport).toBe(blocked.requestId);
  expect((await before.session.deliver(blocked.requestId, null))?.reason).toBe('revoked');
  const after = fixture(), active = after.launch([], false).request;
  expect(after.session.authorize('wrong_id')).toBe(false); expect(after.session.authorize(active.requestId)).toBe(true);
  dispatches++; expect(after.session.authorize(active.requestId)).toBe(false);
  after.advance(10); after.observe(false, 'user_left');
  expect((await after.session.deliver(active.requestId, express(active)))?.reason).toBe('revoked');
  expect(dispatches).toBe(1); expect(after.admitted).toEqual([]);
});
it('rejects unauthorized decisions and permits null preflight cleanup without leaving a transport slot', async () => {
  const f = fixture(), { request } = f.launch([], false);
  expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('invalid_decision');
  expect(f.admitted).toEqual([]); expect(f.session.status().transport).toBeNull();
  expect(f.session.authorize(request.requestId)).toBe(false);
  const g = fixture(), pending = g.launch([], false).request;
  expect((await g.session.deliver(pending.requestId, null))?.reason).toBe('invalid_decision');
  expect(g.session.status().transport).toBeNull(); expect(g.session.status().uncertain).toBe(false);
});
it('checks user intent and final admission permission again before dispatch authorization', async () => {
  for (const revoke of [(f: ReturnType<typeof fixture>) => f.session.userIntent(), (f: ReturnType<typeof fixture>) => f.session.enable(false),
    (f: ReturnType<typeof fixture>) => f.block(), (f: ReturnType<typeof fixture>) => f.session.setUserBusy(true)]) {
    const f = fixture(), { request } = f.launch([], false); revoke(f);
    expect(f.session.authorize(request.requestId)).toBe(false); await f.session.deliver(request.requestId, null);
    expect(f.admitted).toEqual([]);
  }
});

it('revokes delayed observer decisions on newly sequenced orientation and expression events', async () => {
  for (const type of ['looked_back', 'expression_changed'] as const) {
    const f = fixture(); f.observe(true, 'looked_away'); f.advance(750); f.observe();
    const next = f.session.takeRequest()!; expect(f.session.authorize(next.request.requestId)).toBe(true);
    f.advance(10); f.observe(true, type);
    expect(f.session.status().reason).toBe('semantic_changed'); expect(f.session.status().transport).toBe(next.request.requestId);
    expect((await f.session.deliver(next.request.requestId, express(next.request)))?.reason).toBe('revoked');
    expect(f.admitted).toEqual([]); expect(f.cancelled).toEqual([]);
  }
});
it('cancels only an active observer lease on a new semantic event and retains compatible frame acceptance', async () => {
  for (const type of ['looked_back', 'expression_changed'] as const) {
    const f = fixture(), next = f.launch();
    for (let i = 0; i < 20; i++) { f.advance(10); f.observe(); }
    expect((await f.session.deliver(next.request.requestId, express(next.request)))?.reason).toBe('accepted');
    f.advance(10); f.observe(true, type);
    expect(f.cancelled).toHaveLength(1); expect(f.cancelled[0]).toEqual([expect.objectContaining({ actionId: `a${next.request.requestId}` }), 'semantic_changed']);
    expect(f.session.status().owner).toBeNull(); f.session.tick(); expect(f.cancelled).toHaveLength(1);
  }
});
it('ignores duplicate semantic sequences and never cancels a user-owned channel without an observer lease', async () => {
  const f = fixture(), next = f.launch();
  f.advance(10); const fresh = f.observe();
  f.session.observe({ ...fresh, seq: fresh.seq + 1 }, [{ seq: 1, type: 'looked_back', at: f.wall() }]);
  expect((await f.session.deliver(next.request.requestId, express(next.request)))?.reason).toBe('accepted');
  expect(f.cancelled).toEqual([]);
  const user = fixture(), pending = user.launch(); user.session.userIntent(); user.block();
  user.advance(10); user.observe(true, 'looked_back');
  expect((await user.session.deliver(pending.request.requestId, express(pending.request)))?.reason).toBe('revoked');
  expect(user.cancelled).toEqual([]); expect(user.admitted).toEqual([]);
});
it('keeps the latest semantic candidate in a finite burst after invalidating an outstanding request', () => {
  const f = fixture(), next = f.launch();
  f.observe(true, 'looked_back');
  for (let i = 0; i < 100; i++) { f.advance(7); f.observe(true, 'expression_changed'); }
  expect(f.session.status().pending).toBe(2); expect(f.session.status().transport).toBe(next.request.requestId);
  expect(f.session.takeRequest()).toBeNull(); expect(f.session.status().dispatches).toBe(1);
});
it('native presence lane permits slow inference only while its source and causal prerequisites remain current', async () => {
  const f = fixture(); f.session.configureNativeConversation(true); const { request } = f.launch();
  expect(request.deadline - f.now()).toBe(60000);
  for (let i = 0; i < 30; i++) { f.advance(1000); f.observe(true, 'expression_changed'); }
  expect(f.session.canPublish(request)).toBe(true);
  expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('accepted');
  f.block(); expect(f.session.canPublish(request)).toBe(true);
  f.session.userIntent(); expect(f.session.canPublish(request)).toBe(false);
  const stale = fixture(); stale.session.configureNativeConversation(true); const held = stale.launch().request;
  stale.advance(1600); expect(stale.session.canPublish(held)).toBe(false);
});
it('native geometric read-sets reject changed evidence at the final expression admission boundary', async () => {
  const f = fixture(); f.session.configureNativeConversation(true);
  const base = f.observe(), snapshot = { ...base, seq: 100, user: { ...base.user, expression: { smile: 0.1, browRaise: 0.1, eyesClosed: 0.1, mouthOpen: 0.1 } } };
  f.session.observe(snapshot, [{ seq: 100, type: 'expression_changed', at: f.wall() }]);
  f.advance(750); f.session.observe({ ...snapshot, seq: 101, capturedAt: f.wall() }, []);
  const candidate = f.session.takeRequest()!, read = f.session.nativeReadSet(candidate.observationWindow.events);
  expect(f.session.authorize(candidate.request.requestId)).toBe(true); expect(f.session.canPublish(candidate.request, read)).toBe(true);
  f.advance(20); f.session.observe({ ...snapshot, seq: 102, capturedAt: f.wall(), user: { ...snapshot.user, expression: { ...snapshot.user.expression, smile: 0.9 } } }, []);
  expect(f.session.canPublish(candidate.request, read)).toBe(false);
  expect((await f.session.deliver(candidate.request.requestId, express(candidate.request)))?.reason).toBe('admission_failed'); expect(f.admitted).toEqual([]);
});
it('native execution ownership expires independently of its slow admission deadline and consent cannot revive it', async () => {
  const f = fixture(); f.session.configureNativeConversation(true); const { request } = f.launch();
  for (let i = 0; i < 58; i++) { f.advance(1000); f.observe(); }
  expect((await f.session.deliver(request.requestId, express(request)))?.reason).toBe('accepted');
  const lease = (f.admitted[0] as any[])[1]; expect(lease.validUntil).toBeGreaterThan(request.deadline);
  for (let i = 0; i < 6; i++) { f.advance(1000); f.observe(); f.session.tick(); }
  expect(f.session.status().owner).toBeNull(); expect(f.cancelled).toHaveLength(1);
  const g = fixture(); g.session.configureNativeConversation(true); const held = g.launch().request;
  g.session.enable(false); g.session.enable(true); g.observe(); expect(g.session.canPublish(held)).toBe(false);
  expect((await g.session.deliver(held.requestId, express(held)))?.reason).toBe('revoked');
});

it('native conversation can observe a protected idle scene while all visual admission stays blocked', async () => {
  const f = fixture(() => true); f.session.configureNativeConversation(true); f.block();
  const { request } = f.launch(); expect(f.session.canPublish(request)).toBe(true);
  expect((await f.session.deliver(request.requestId, observeDecision(request)))?.reason).toBe('observed');
  expect(f.admitted).toEqual([]);
  const g = fixture(() => true); g.session.configureNativeConversation(true); g.block();
  const held = g.launch().request;
  expect((await g.session.deliver(held.requestId, express(held)))?.reason).toBe('admission_failed'); expect(g.admitted).toEqual([]);
});
it('conversation permission is Native-only and retains active, stopped and stale-source fences', () => {
  const legacy = fixture(() => true); legacy.block(); legacy.observe(true, 'user_arrived'); legacy.advance(750); legacy.observe();
  expect(legacy.session.takeRequest()).toBeNull();
  const denied = fixture(() => false); denied.session.configureNativeConversation(true);
  denied.observe(true, 'user_arrived'); denied.advance(750); denied.observe(); expect(denied.session.takeRequest()).toBeNull();
  for (const stop of [(f: ReturnType<typeof fixture>) => f.session.enable(false), (f: ReturnType<typeof fixture>) => f.session.setUserBusy(true),
    (f: ReturnType<typeof fixture>) => f.advance(1600), (f: ReturnType<typeof fixture>) => f.session.userIntent()]) {
    const f = fixture(() => true); f.session.configureNativeConversation(true); f.block(); const { request } = f.launch(); stop(f);
    expect(f.session.canPublish(request)).toBe(false);
  }
});
