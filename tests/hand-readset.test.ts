import { expect, it } from 'vitest';
import { ReactiveDecisionHost } from '../src/core/live/decision-host';
import { ReactiveLeaseGuard } from '../src/core/live/reactive-lease';
import { freezeHandReadSet, type ReactiveRequest, type ReactiveState } from '../src/core/live/decision-types';
import { CausalRecorder } from '../src/core/live/causal-recorder';
function fixture(primaryTrackId: string | null = 'hand_1_1') {
  let now = 100, resolve!: (value: unknown) => void;
  const hand = { stateRevision: 3, sourceGeneration: 1, primaryTrackId };
  const state: ReactiveState = { sessionId: 's', epoch: 'e', intentRevision: 0, trackIds: [], handState: { ...hand } };
  const request: ReactiveRequest = { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'r', intentRevision: 0,
    deadline: 1000, requiredTrackIds: [], handReadSet: hand };
  const admissions: unknown[] = [], cancellations: string[] = [];
  const host = new ReactiveDecisionHost(() => state, () => now);
  const guard = new ReactiveLeaseGuard(() => state, () => now, (_owner, reason) => cancellations.push(reason));
  const ownership = { requestId: 'r', decisionId: 'd', actionId: 'a', validUntil: 900 };
  const output = { schemaVersion: 1, requestId: 'r', decisionId: 'd', mode: 'express', validUntil: 900,
    action: { actionId: 'a', body: { type: 'wait', durationMs: 200 } } };
  const adapter = { decide: () => new Promise(done => { resolve = done; }) };
  return { state, request, host, guard, ownership, output, adapter, admissions, cancellations,
    admit: (value: unknown) => admissions.push(value), finish: () => resolve(output), advance: () => { now++; } };
}
it('invalidates a lost-hand reaction immediately on return before a debounced appearance event exists', async () => {
  const f = fixture(null), pending = f.host.run(f.request, f.adapter, f.admit);
  f.state.handState = { stateRevision: 4, sourceGeneration: 1, primaryTrackId: 'hand_1_1' };
  f.finish(); expect((await pending).reason).toBe('stale'); expect(f.admissions).toEqual([]);
  const lease = fixture(null); expect(lease.guard.acquire(lease.request, lease.ownership, 0)).toBe(true);
  lease.state.handState = { stateRevision: 4, sourceGeneration: 1, primaryTrackId: 'hand_1_1' };
  expect(lease.guard.check()).toBe(false); expect(lease.cancellations).toEqual(['hand_changed']);
});
it('rejects primary swaps, source generations, loss, semantic boundaries and missing hand state', async () => {
  for (const handState of [{ stateRevision: 3, sourceGeneration: 1, primaryTrackId: 'hand_1_2' },
    { stateRevision: 3, sourceGeneration: 2, primaryTrackId: 'hand_1_1' },
    { stateRevision: 4, sourceGeneration: 1, primaryTrackId: null },
    { stateRevision: 4, sourceGeneration: 1, primaryTrackId: 'hand_1_1' }, undefined]) {
    const f = fixture(), pending = f.host.run(f.request, f.adapter, f.admit);
    f.state.handState = handState; f.finish(); expect((await pending).reason).toBe('stale');
    const g = fixture(); expect(g.guard.acquire(g.request, g.ownership, 0)).toBe(true); g.state.handState = handState;
    expect(g.guard.check()).toBe(false); expect(g.guard.check()).toBe(false); expect(g.cancellations).toEqual(['hand_changed']);
  }
});
it('keeps same continuing-motion semantic state valid across fresh frames and freezes nested ownership', async () => {
  const f = fixture(), pending = f.host.run(f.request, f.adapter, f.admit);
  expect(f.guard.acquire(f.request, f.ownership, 0)).toBe(true);
  for (let frame = 0; frame < 100; frame++) { f.advance(); f.state.handState = { ...f.state.handState! }; expect(f.guard.check()).toBe(true); }
  f.finish(); expect((await pending).reason).toBe('accepted'); expect(f.cancellations).toEqual([]);
  expect(Object.isFrozen(f.guard.owner!.handReadSet)).toBe(true);
  expect(f.guard.owner!.handReadSet).not.toBe(f.request.handReadSet);
});
it('strictly validates optional read sets while retaining legacy offline v1 compatibility', async () => {
  const malformed = [undefined, null, { stateRevision: -1, sourceGeneration: 0, primaryTrackId: null },
    { stateRevision: 1.5, sourceGeneration: 0, primaryTrackId: null }, { stateRevision: 1, sourceGeneration: Infinity, primaryTrackId: null },
    { stateRevision: 1, sourceGeneration: 0, primaryTrackId: 'private text' },
    { stateRevision: 1, sourceGeneration: 0, primaryTrackId: null, transcript: 'PRIVATE' }];
  for (const handReadSet of malformed) {
    const f = fixture(); expect((await f.host.run({ ...f.request, handReadSet } as any, { decide: async () => f.output }, f.admit)).reason).toBe('invalid_request');
    expect(f.guard.acquire({ ...f.request, handReadSet } as any, f.ownership, 0)).toBe(false);
  }
  const f = fixture(), { handReadSet, ...legacy } = f.request; f.state.handState = undefined;
  expect((await f.host.run(legacy, { decide: async () => f.output }, f.admit)).reason).toBe('accepted');
  expect(f.guard.acquire(legacy, f.ownership, 0)).toBe(true);
});
it('rejects accessor state without evaluating it and rechecks hands after compilation', async () => {
  let reads = 0; const input = Object.defineProperty({ sourceGeneration: 1, primaryTrackId: null }, 'stateRevision', { get: () => { reads++; return 1; } });
  expect(() => freezeHandReadSet(input)).toThrow('hand_readset'); expect(reads).toBe(0);
  const f = fixture(); const host = new ReactiveDecisionHost(() => f.state, () => 100, { compile: () => {
    f.state.handState = { stateRevision: 4, sourceGeneration: 1, primaryTrackId: null }; return { program: {} };
  } } as never);
  expect((await host.run(f.request, { decide: async () => f.output }, f.admit)).reason).toBe('stale'); expect(f.admissions).toEqual([]);
});
it('records additive hand read sets and hand_changed revocations without weakening receipt validation', () => {
  const f = fixture(null), recorder = new CausalRecorder({ now: () => 100, wallNow: () => 1000, epoch: () => 'e' });
  recorder.start({ runId: 'run', mode: 'synthetic' });
  expect(recorder.append('request', { request: f.request, observationRefs: [], eventRefs: [] })).toBe(true);
  expect(recorder.append('revocation', { reason: 'hand_changed', requestId: 'r' })).toBe(true);
  expect(recorder.append('provider_receipt', { requestId: 'r', modelConfigHash: 'a'.repeat(64), promptHash: 'b'.repeat(64),
    requestHash: 'c'.repeat(64), responseHash: null, outcome: 'transport_unknown', durationMs: null, usage: 'unknown' })).toBe(true);
  expect((recorder.snapshot().records[0].payload as any).request.handReadSet.primaryTrackId).toBeNull();
  expect(recorder.append('request', { request: { ...f.request, handReadSet: { ...f.request.handReadSet!, body: 'PRIVATE' } }, observationRefs: [], eventRefs: [] } as any)).toBe(false);
  expect(JSON.stringify(recorder.snapshot())).not.toContain('PRIVATE');
});
