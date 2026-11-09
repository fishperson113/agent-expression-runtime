import { expect, it } from 'vitest';
import { ReactiveDecisionHost } from '../src/core/live/decision-host';
import type { ReactiveRequest, ReactiveState } from '../src/core/live/decision-types';

function fixture() {
  let now = 100;
  const state: ReactiveState = { sessionId: 's', epoch: 'e', intentRevision: 0, trackIds: ['handA'] };
  const request: ReactiveRequest = { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'r',
    intentRevision: 0, deadline: 1000, requiredTrackIds: ['handA'] };
  const host = new ReactiveDecisionHost(() => state, () => now), applied: unknown[] = [];
  const admit = (value: unknown) => { applied.push(value); };
  const output = { schemaVersion: 1, requestId: 'r', decisionId: 'd', mode: 'express', validUntil: 900,
    action: { actionId: 'a', body: { type: 'wait', durationMs: 100 } } };
  let resolve!: (value: unknown) => void;
  const adapter = { decide: async () => new Promise<unknown>(done => { resolve = done; }) };
  return { state, request, host, applied, admit, output, adapter, resolve: (value: unknown) => resolve(value), tick: (at: number) => { now = at; } };
}
it('freezes input and accepts a compatible later observation of the same track', async () => {
  const f = fixture(); let frozen = false;
  const adapter = { decide: async (request: ReactiveRequest) => {
    frozen = Object.isFrozen(request) && Object.isFrozen(request.requiredTrackIds); return f.output;
  } };
  expect((await f.host.run(f.request, adapter, f.admit)).reason).toBe('accepted');
  expect(frozen).toBe(true); expect(f.applied).toHaveLength(1);
  expect((await f.host.run(f.request, adapter, f.admit)).reason).toBe('duplicate');
});
it('permits ordinary newer frames without comparing frame revisions', async () => {
  const f = fixture(), pending = f.host.run(f.request, f.adapter, f.admit);
  f.state.trackIds = ['handA', 'handB']; f.tick(200); f.resolve(f.output);
  expect((await pending).reason).toBe('accepted');
});
it('drops lost tracks, changed intent, changed epoch/session and late callbacks', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.state.trackIds = []; },
    (f: ReturnType<typeof fixture>) => { f.state.intentRevision++; },
    (f: ReturnType<typeof fixture>) => { f.state.epoch = 'new'; },
    (f: ReturnType<typeof fixture>) => { f.state.sessionId = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.tick(1000); },
  ]) {
    const f = fixture(), pending = f.host.run(f.request, f.adapter, f.admit); mutate(f); f.resolve(f.output);
    expect((await pending).reason).toBe('stale'); expect(f.applied).toHaveLength(0);
  }
});
it('keeps one transport slot after revocation and never applies its late response', async () => {
  const f = fixture(), pending = f.host.run(f.request, f.adapter, f.admit);
  f.host.revoke();
  expect((await f.host.run({ ...f.request, requestId: 'other' }, f.adapter, f.admit)).reason).toBe('busy');
  f.resolve(f.output); expect((await pending).reason).toBe('revoked'); expect(f.applied).toHaveLength(0);
});
it('accepts observe as terminal and rejects text, mismatched IDs and malformed requests', async () => {
  const f = fixture(), adapter = (output: unknown) => ({ decide: async () => output });
  expect((await f.host.run(f.request, adapter({ ...f.output, mode: 'observe', action: null }), f.admit)).reason).toBe('observed');
  for (const output of ['unrelated Python text', { ...f.output, requestId: 'wrong' }, { ...f.output, text: 'hello' },
    { ...f.output, validUntil: Infinity }, { ...f.output, mode: 'observe' }]) {
    const g = fixture(); expect((await g.host.run(g.request, adapter(output), g.admit)).reason).toBe('invalid_decision');
    expect(g.applied).toHaveLength(0);
  }
  expect((await f.host.run({ ...f.request, schemaVersion: 2 } as unknown as ReactiveRequest, adapter(null), f.admit)).reason).toBe('invalid_request');
});
it('uses the existing compiler to reject scripts, unknown primitives and unbounded poses', async () => {
  for (const body of [{ type: 'script', code: 'run()' }, { type: 'teleport' }, { type: 'live', program: null,
    configuration: { controls: [], poses: [{ type: 'pose', target: { part: 'body', prop: 'x' }, value: 99, durationMs: 100 }], lifetimeMs: 1000 } }]) {
    const f = fixture();
    expect((await f.host.run(f.request, { decide: async () => ({ ...f.output, action: { actionId: 'a', body } }) }, f.admit)).reason).toBe('invalid_decision');
    expect(f.applied).toHaveLength(0);
  }
});
it('deduplicates decisions and actions across distinct request deliveries', async () => {
  const f = fixture(), adapter = { decide: async () => f.output };
  expect((await f.host.run(f.request, adapter, f.admit)).reason).toBe('accepted');
  const request = { ...f.request, requestId: 'r2' };
  expect((await f.host.run(request, { decide: async () => ({ ...f.output, requestId: 'r2', decisionId: 'd2' }) }, f.admit)).reason).toBe('duplicate');
  expect(f.applied).toHaveLength(1);
});
it('does not retry unknown transport or admission outcomes', async () => {
  const f = fixture();
  const unknown = await f.host.run(f.request, { decide: async () => { throw Error('disconnect'); } }, f.admit);
  expect(unknown.reason).toBe('transport_unknown');
  expect((await f.host.run({ ...f.request, requestId: 'next' }, f.adapter, f.admit)).reason).toBe('busy');
  expect(f.host.confirmTransportSettled(999)).toBe(false);
  expect(f.host.confirmTransportSettled(unknown.transportToken!)).toBe(true);
  expect(f.host.confirmTransportSettled(unknown.transportToken!)).toBe(false);
  expect((await f.host.run({ ...f.request, requestId: 'next' }, { decide: async () => ({ ...f.output,
    requestId: 'next', mode: 'observe', action: null }) }, f.admit)).reason).toBe('observed');
  expect((await f.host.run(f.request, f.adapter, f.admit)).reason).toBe('duplicate');
  const g = fixture();
  expect((await g.host.run(g.request, { decide: async () => g.output }, () => { throw Error('unknown'); })).reason).toBe('admission_failed');
  expect((await g.host.run(g.request, g.adapter, g.admit)).reason).toBe('duplicate');
});
it('checks decision TTL and fails closed at its bounded receipt capacity', async () => {
  const f = fixture(); f.tick(900);
  expect((await f.host.run(f.request, { decide: async () => f.output }, f.admit)).reason).toBe('stale');
  const g = fixture();
  for (let index = 0; index < 256; index++) {
    const requestId = 'r' + index;
    expect((await g.host.run({ ...g.request, requestId }, { decide: async () => ({ ...g.output, requestId,
      decisionId: 'd' + index, mode: 'observe', action: null }) }, g.admit)).reason).toBe('observed');
  }
  expect((await g.host.run({ ...g.request, requestId: 'overflow' }, g.adapter, g.admit)).reason).toBe('capacity');
});
it('checks causal prerequisites again after compilation immediately before synchronous admission', async () => {
  const f = fixture(); let admissions = 0;
  const compiler = { compile: () => { f.state.trackIds = []; return { program: {} }; } };
  const host = new ReactiveDecisionHost(() => f.state, () => 100, compiler as never);
  expect((await host.run(f.request, { decide: async () => f.output }, () => { admissions++; })).reason).toBe('stale');
  expect(admissions).toBe(0);
});
