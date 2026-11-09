import { expect, it } from 'vitest';
import { ReactiveDecisionHost } from '../src/core/live/decision-host';
import { ReactiveLeaseGuard, type LeaseRevokeReason, type ReactiveLease } from '../src/core/live/reactive-lease';
import type { ReactiveRequest, ReactiveState } from '../src/core/live/decision-types';

function fixture() {
  let now = 100;
  const state: ReactiveState = { sessionId: 's', epoch: 'e', intentRevision: 0, presenceRevision: 1, trackIds: ['handA'] };
  const request: ReactiveRequest = { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'r',
    intentRevision: 0, presenceRevision: 1, deadline: 1000, requiredTrackIds: ['handA'] };
  const revoked: { owner: ReactiveLease; reason: LeaseRevokeReason }[] = [], admissions: unknown[] = [];
  const guard = new ReactiveLeaseGuard(() => state, () => now, (owner, reason) => revoked.push({ owner, reason }));
  const host = new ReactiveDecisionHost(() => state, () => now);
  const ownership = { requestId: 'r', decisionId: 'd', actionId: 'a', validUntil: 900 };
  const output = { schemaVersion: 1, requestId: 'r', decisionId: 'd', validUntil: 900, mode: 'express',
    action: { actionId: 'a', body: { type: 'wait', durationMs: 100 } } };
  const generation = guard.generation;
  const admit = (compiled: unknown, owner: typeof ownership) => {
    if (!guard.acquire(request, owner, generation)) throw Error('lease_rejected');
    admissions.push(compiled);
  };
  return { state, request, guard, host, ownership, output, revoked, admissions, admit, tick: (at: number) => { now = at; } };
}
it('rejects arrival then departure then delayed express even after the person returns', async () => {
  const f = fixture(); let finish!: (value: unknown) => void;
  const pending = f.host.run(f.request, { decide: () => new Promise(resolve => { finish = resolve; }) }, f.admit);
  f.state.presenceRevision = 2; f.state.trackIds = [];
  f.state.presenceRevision = 3; f.state.trackIds = ['handA'];
  finish(f.output); expect((await pending).reason).toBe('stale');
  expect(f.admissions).toEqual([]); expect(f.guard.owner).toBeUndefined();
});
it('accepts compatible newer frames, freezes ownership and releases only the matching action', async () => {
  const f = fixture(); f.state.trackIds = ['handA', 'handB']; f.tick(200);
  expect((await f.host.run(f.request, { decide: async () => f.output }, f.admit)).reason).toBe('accepted');
  expect(f.guard.check()).toBe(true); expect(Object.isFrozen(f.guard.owner)).toBe(true);
  expect(Object.isFrozen(f.guard.owner!.requiredTrackIds)).toBe(true);
  expect(f.guard.release('other')).toBe(false); expect(f.guard.release('a')).toBe(true);
  expect(f.guard.release('a')).toBe(false); expect(f.revoked).toEqual([]);
  expect(f.guard.acquire(f.request, f.ownership, f.guard.generation)).toBe(false);
});
it('revokes admitted work once on expiry, track loss, intent, session, epoch or presence change', () => {
  for (const [reason, mutate] of [
    ['expired', (f: ReturnType<typeof fixture>) => f.tick(900)],
    ['track_lost', (f: ReturnType<typeof fixture>) => { f.state.trackIds = []; }],
    ['intent_changed', (f: ReturnType<typeof fixture>) => { f.state.intentRevision++; }],
    ['session_changed', (f: ReturnType<typeof fixture>) => { f.state.sessionId = 'new'; }],
    ['epoch_changed', (f: ReturnType<typeof fixture>) => { f.state.epoch = 'new'; }],
    ['presence_changed', (f: ReturnType<typeof fixture>) => { f.state.presenceRevision = 2; }],
  ] as const) {
    const f = fixture(); expect(f.guard.acquire(f.request, f.ownership, f.guard.generation)).toBe(true);
    mutate(f); expect(f.guard.check()).toBe(false); expect(f.guard.check()).toBe(false); f.guard.revoke();
    expect(f.revoked).toHaveLength(1); expect(f.revoked[0].reason).toBe(reason);
  }
});
it('blocks revoke between compilation and admission and invalidates a returning prerequisite', async () => {
  const f = fixture(), generation = f.guard.generation;
  const compiler = { compile: () => { f.guard.revoke(); return { program: {} }; } };
  const host = new ReactiveDecisionHost(() => f.state, () => 100, compiler as never);
  expect((await host.run(f.request, { decide: async () => f.output }, f.admit)).reason).toBe('admission_failed');
  expect(f.admissions).toEqual([]); expect(f.guard.acquire(f.request, f.ownership, generation)).toBe(false);
});
it('rejects malformed optional presence revisions and keeps old requests compatible', async () => {
  for (const presenceRevision of [undefined, -1, NaN, 1.5]) {
    const f = fixture();
    expect((await f.host.run({ ...f.request, presenceRevision }, { decide: async () => f.output }, f.admit)).reason).toBe('invalid_request');
  }
  const f = fixture(), { presenceRevision, ...legacy } = f.request;
  f.state.presenceRevision = 99;
  expect((await f.host.run(legacy, { decide: async () => f.output }, () => {})).reason).toBe('accepted');
});
it('rejects overlapping leases and stale or invalid admission boundaries without side effects', () => {
  const f = fixture(); expect(f.guard.acquire(f.request, { ...f.ownership, validUntil: Infinity }, 0)).toBe(false);
  expect(f.guard.acquire(f.request, { ...f.ownership, validUntil: 1001 }, 0)).toBe(false);
  expect(f.guard.acquire(f.request, f.ownership, 0)).toBe(true);
  expect(f.guard.acquire({ ...f.request, requestId: 'r2' }, { ...f.ownership, requestId: 'r2', actionId: 'a2' }, 0)).toBe(false);
  f.guard.revoke(); expect(f.revoked[0].reason).toBe('revoked');
  expect(f.guard.acquire(f.request, { ...f.ownership, actionId: 'a2' }, 0)).toBe(false);
});
