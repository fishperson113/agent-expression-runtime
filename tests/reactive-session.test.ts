import { expect, it } from 'vitest';
import { ReactiveSession } from '../src/core/live/reactive-session';
import { unavailableUser, type Observation } from '../src/core/live/types';
import type { ReactiveRequest } from '../src/core/live/decision-types';

function fixture() {
  let now = 1000, wall = 10000, seq = 0, event = 0, id = 0, epoch = 'epoch', canAdmit = true;
  const admitted: unknown[] = [], cancelled: unknown[] = [];
  const session = new ReactiveSession({ now: () => now, wallNow: () => wall, epoch: () => epoch, id: () => `r${++id}`,
    canAdmit: () => canAdmit, admit: (...args) => admitted.push(args), cancel: (...args) => cancelled.push(args) });
  const observe = (present = true, type?: 'user_arrived' | 'user_left' | 'expression_changed', tracks: string[] = []) => {
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
    rollback: () => { now -= 10; }, launch: (tracks: string[] = []) => { observe(true, 'user_arrived', tracks); advance(750); observe(true, undefined, tracks); return session.takeRequest()!; } };
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
    expect(next).toBeTruthy(); await f.session.deliver(next.request.requestId, turn === 1 ? 'invalid text' : observeDecision(next.request));
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
    expect(next).toBeTruthy(); expect((await f.session.deliver(next.request.requestId, observeDecision(next.request)))?.reason).toBe('observed');
  }
  f.session.reset(); f.advance(15000); f.observe(true, 'expression_changed'); f.advance(750); f.observe();
  expect(f.session.status().dispatches).toBe(256); expect(f.session.takeRequest()).toBeNull();
});
