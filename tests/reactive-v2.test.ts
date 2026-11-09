import { expect, it } from 'vitest';
import { ReactiveDecisionHost } from '../src/core/live/decision-host';
import { ReactiveLeaseGuard } from '../src/core/live/reactive-lease';
import { freezeSemanticSnapshot, freezePrerequisites } from '../src/core/live/decision-contract';
import type { ReactiveRequest, ReactiveState, SemanticPrerequisite } from '../src/core/live/decision-types';
function fixture(version: 1 | 2 = 2) {
  let now = 0;
  const semanticSnapshot = { orientation: 1, expression: 1, handMotion: 1, handIdentity: 1 };
  const state: ReactiveState = { sessionId: 's', epoch: 'e', intentRevision: 0, presenceRevision: 1,
    trackIds: ['a'], sourceHealthy: true, semanticSnapshot: { ...semanticSnapshot },
    handState: { stateRevision: 1, sourceGeneration: 1, primaryTrackId: 'a' } };
  const common = { sessionId: 's', epoch: 'e', requestId: 'r', intentRevision: 0, presenceRevision: 1,
    deadline: 5000, requiredTrackIds: ['a'], handReadSet: { ...state.handState! } };
  const request: ReactiveRequest = version === 2 ? { ...common, schemaVersion: 2, semanticSnapshot } : { ...common, schemaVersion: 1 };
  const revoked: string[] = [];
  const guard = new ReactiveLeaseGuard(() => state, () => now, (_, reason) => revoked.push(reason));
  const host = new ReactiveDecisionHost(() => state, () => now);
  const output = (prerequisites: SemanticPrerequisite[] = []) => ({ schemaVersion: version, requestId: 'r', decisionId: 'd',
    validUntil: 5000, mode: 'express', ...(version === 2 ? { prerequisites } : {}), action: { actionId: 'a', body: {
      type: 'sequence', children: [{ type: 'parallel', children: [{ type: 'morph', target: 'sphere', durationMs: 500 }] }] } } });
  const generation = guard.generation;
  const run = (value: unknown = output()) => host.run(request, { decide: async () => value }, (_, owner) => {
    if (!guard.acquire(request, owner, generation)) throw Error('rejected');
  });
  return { request, state, guard, host, output, run, revoked, clock: (at: number) => { now = at; } };
}
it('gives V2 a host bounded execution lease after a 4.9 second admission; legacy expires', async () => {
  for (const version of [1, 2] as const) {
    const f = fixture(version); f.clock(4900);
    const result = await f.run(); expect(result.reason).toBe('accepted');
    expect(result.executionValidUntil).toBe(version === 2 ? 5500 : undefined);
    f.clock(5400); expect(f.guard.check()).toBe(version === 2);
    f.clock(5500); expect(f.guard.check()).toBe(false); expect(f.revoked).toEqual(['expired']);
  }
});
it('never extends the admission deadline or grants late/overlong execution ownership', async () => {
  const f = fixture(); f.clock(5000); expect((await f.run()).reason).toBe('stale');
  f.clock(4900);
  for (const executionValidUntil of [4900, 6001, Infinity]) expect(f.guard.acquire(f.request, {
    requestId: 'r', decisionId: 'd', actionId: 'a', validUntil: 5000, decisionVersion: 2,
    prerequisites: [], executionValidUntil }, 0)).toBe(false);
});
it('selects optional semantics without waiving critical identity or source health', async () => {
  for (const selected of [[], ['expression']] as SemanticPrerequisite[][]) {
    const f = fixture(); f.state.semanticSnapshot = { ...f.state.semanticSnapshot!, expression: 2 };
    expect((await f.run(f.output(selected))).reason).toBe(selected.length ? 'stale' : 'accepted');
  }
  for (const mutate of [
    (s: ReactiveState) => { s.sourceHealthy = false; }, (s: ReactiveState) => { s.intentRevision++; },
    (s: ReactiveState) => { s.presenceRevision!++; }, (s: ReactiveState) => { s.epoch = 'new'; },
    (s: ReactiveState) => { s.trackIds = []; }, (s: ReactiveState) => { s.semanticSnapshot = { ...s.semanticSnapshot!, handIdentity: 3 }; },
    (s: ReactiveState) => { s.handState = { ...s.handState!, sourceGeneration: 2 }; },
  ]) {
    const f = fixture(); expect((await f.run()).reason).toBe('accepted'); mutate(f.state);
    expect(f.guard.check()).toBe(false); expect(f.revoked).toHaveLength(1);
  }
});
it('preserves moving frames but enforces selected hand motion on every execution tick', async () => {
  for (const selected of [[], ['hand_motion']] as SemanticPrerequisite[][]) {
    const f = fixture(); expect((await f.run(f.output(selected))).reason).toBe('accepted');
    f.state.handState = { ...f.state.handState!, stateRevision: 2 };
    expect(f.guard.check()).toBe(!selected.length);
  }
});
it('rejects null critical history, unknown selected axes, duplicates and unsafe spatial/oversized bodies', async () => {
  expect(() => freezeSemanticSnapshot({ orientation: null, expression: null, handMotion: null, handIdentity: null })).toThrow();
  expect(() => freezePrerequisites(['expression', 'expression'])).toThrow();
  const f = fixture(); if (f.request.schemaVersion === 2) Object.assign(f.request, { semanticSnapshot: { ...f.request.semanticSnapshot, expression: null } });
  expect((await f.run(f.output(['expression']))).reason).toBe('invalid_decision');
  for (const leaf of [{ type: 'wait', durationMs: 500 }, { type: 'morph', target: 'sphere', durationMs: 1001 },
    { type: 'morph', target: 'sphere', durationMs: 199 }, { type: 'morph', target: 'sphere', durationMs: 500, targetPosition: [0, 0, 0] }]) {
    const g = fixture(), output = g.output(); output.action.body.children[0].children = [leaf as never];
    expect((await g.run(output)).reason).toBe('invalid_decision');
  }
  const g = fixture(); expect((await g.run()).reason).toBe('accepted'); expect((await g.run()).reason).toBe('duplicate');
});
it('validates delayed responses after await and rejects model-authored lease authority', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => f.clock(5001),
    (f: ReturnType<typeof fixture>) => { f.state.semanticSnapshot = { ...f.state.semanticSnapshot!, handIdentity: 3 }; },
  ]) {
    const f = fixture(); let finish!: (value: unknown) => void;
    const pending = f.host.run(f.request, { decide: () => new Promise(resolve => { finish = resolve; }) }, () => { throw Error('unsafe_admission'); });
    mutate(f); finish(f.output()); expect((await pending).reason).toBe('stale');
  }
  const f = fixture(); expect((await f.run({ ...f.output(), executionValidUntil: 99999 })).reason).toBe('invalid_decision');
  const g = fixture(); expect((await g.run({ ...g.output(), mode: 'observe', action: null })).reason).toBe('observed');
  expect(g.guard.owner).toBeUndefined();
});
it('does not accept a revoked generation between compile and synchronous acquisition', async () => {
  const f = fixture(), generation = f.guard.generation;
  const compiler = { compile: () => { f.guard.revoke(); return { program: { kind: 'program', duration: 500 } }; } };
  const host = new ReactiveDecisionHost(() => f.state, () => 4900, compiler as never);
  const result = await host.run(f.request, { decide: async () => f.output() }, (_, owner) => {
    if (!f.guard.acquire(f.request, owner, generation)) throw Error('revoked');
  });
  expect(result.reason).toBe('admission_failed'); expect(result.executionValidUntil).toBeUndefined();
  expect(f.guard.owner).toBeUndefined();
});
