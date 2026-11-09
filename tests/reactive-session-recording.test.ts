import { expect, it } from 'vitest';
import { CausalRecorder } from '../src/core/live/causal-recorder';
import { SceneTrace } from '../src/core/live/trace';
import type { ReactiveOwnership } from '../src/core/live/decision-types';
import { ReactiveSession } from '../src/core/live/reactive-session';
import { unavailableUser, type Observation, type LiveEventKind } from '../src/core/live/types';
import type { CausalKind, CausalPayloads, CausalSink } from '../src/core/live/causal-recorder-types';

function fixture(sink?: CausalSink, onAdmit?: (owner: ReactiveOwnership) => void) {
  let now = 0, seq = 0, eventSeq = 0, admitted = 0, cancelled = 0;
  const records: { kind: CausalKind; payload: any }[] = [];
  const record: CausalSink = (kind, payload) => { records.push({ kind, payload }); sink?.(kind, payload); };
  const session = new ReactiveSession({ now: () => now, wallNow: () => 10000 + now, epoch: () => 'epoch', id: () => 'request',
    canAdmit: () => true, admit: (_compiled, owner) => { admitted++; onAdmit?.(owner); }, cancel: () => { cancelled++; }, record });
  const observe = (type?: LiveEventKind, camera: Observation['camera'] = 'tracking') => {
    session.observe({ v: 1, sessionId: 'source', seq: ++seq, capturedAt: 10000 + now, camera, turn: 'idle',
      summary: 'PRIVATE_SUMMARY_CANARY', user: { ...unavailableUser(), present: camera === 'tracking' } },
    type ? [{ type, seq: ++eventSeq, at: 10000 + now }] : []);
  };
  const launch = () => { observe('user_arrived'); now += 750; observe(); return session.takeRequest()!; };
  const express = () => ({ schemaVersion: 1, requestId: 'request', decisionId: 'decision', mode: 'express', validUntil: now + 1000,
    action: { actionId: 'action', body: { type: 'wait', durationMs: 300 } } });
  session.configure(true); session.enable(true);
  return { session, records, observe, launch, express, now: () => now, wall: () => 10000 + now, advance: (ms: number) => { now += ms; }, counts: () => ({ admitted, cancelled }) };
}
it('links frozen request refs to only the coalesced event window and its observations', () => {
  const f = fixture(); f.observe('user_arrived'); f.observe('looked_away'); f.observe('looked_back');
  f.advance(750); f.observe(); const window = f.session.takeRequest()!;
  const request = f.records.find(record => record.kind === 'request')!.payload as CausalPayloads['request'];
  expect(request.eventRefs).toEqual([{ sessionId: 'source', seq: 1 }, { sessionId: 'source', seq: 3 }]);
  expect(request.observationRefs).toEqual(window.observationWindow.observations.map(value => ({ sessionId: value.sessionId, seq: value.seq })));
  expect(f.records.filter(record => record.kind === 'event').map(record => record.payload.observationSeq)).toEqual([1, 2, 3]);
  expect(JSON.stringify(f.records)).not.toContain('PRIVATE_SUMMARY_CANARY');
});
it('records one terminal decision with trusted metadata, separate from execution or raw action bodies', async () => {
  const f = fixture(), request = f.launch();
  expect(f.session.authorize('untrusted-private-id')).toBe(false);
  expect(f.session.authorize(request.request.requestId)).toBe(true); expect(f.session.authorize(request.request.requestId)).toBe(false);
  expect((await f.session.deliver('request', f.express()))?.reason).toBe('accepted');
  expect(await f.session.deliver('request', { private: 'RAW_PROVIDER_CANARY' })).toBeNull();
  const authorizations = f.records.filter(record => record.kind === 'authorization');
  expect(authorizations.map(record => record.payload)).toEqual([{ requestId: 'request', allowed: true, reason: 'authorized' }]);
  expect(f.records.filter(record => record.kind === 'decision').map(record => record.payload)).toEqual([
    { requestId: 'request', decisionId: 'decision', actionId: 'action', mode: 'express', validUntil: 1750, reason: 'accepted' }]);
  expect(f.records.some(record => ['execution', 'frame'].includes(record.kind))).toBe(false);
  expect(JSON.stringify(f.records)).not.toMatch(/RAW_PROVIDER_CANARY|durationMs|"body"/);
});
it('records effective revocation once and bounds denied authorization for matching requests', async () => {
  const f = fixture(); f.launch(); f.session.userIntent(); f.session.userIntent(); f.session.configure(false); f.session.configure(false);
  for (let i = 0; i < 100; i++) expect(f.session.authorize('request')).toBe(false);
  expect(f.records.filter(record => record.kind === 'revocation')).toHaveLength(1);
  expect(f.records.filter(record => record.kind === 'authorization')).toHaveLength(1);
  expect((await f.session.deliver('request', f.express()))?.reason).toBe('revoked');
  expect(f.records.filter(record => record.kind === 'decision')).toHaveLength(1);
  expect(f.counts().admitted).toBe(0);
});
it('does not retain invalid observations and records valid unavailable source states', () => {
  const f = fixture(); f.observe(undefined, 'stopped');
  f.session.observe({ private: 'INVALID_OBSERVATION_CANARY' } as any, []);
  expect(f.records.filter(record => record.kind === 'observation')).toHaveLength(1);
  expect(f.records.find(record => record.kind === 'observation')!.payload.camera).toBe('stopped');
  expect(JSON.stringify(f.records)).not.toContain('INVALID_OBSERVATION_CANARY');
});
it('catches every sink exception and isolates sink mutation from admission and cancellation', async () => {
  const f = fixture((_kind, payload) => { (payload as any).requestId = 'mutated'; throw Error('disk full'); });
  const request = f.launch(); expect(request.request.requestId).toBe('request');
  expect(f.session.authorize('request')).toBe(true);
  expect((await f.session.deliver('request', f.express()))?.reason).toBe('accepted');
  f.observe('expression_changed'); expect(f.counts()).toEqual({ admitted: 1, cancelled: 1 });
});
it('records active lease cancellation once with trusted decision and action identifiers', async () => {
  const f = fixture(); f.launch(); f.session.authorize('request'); await f.session.deliver('request', f.express());
  f.observe('looked_back'); f.observe('expression_changed');
  expect(f.records.filter(record => record.kind === 'revocation').map(record => record.payload)).toEqual([
    { reason: 'semantic_changed', requestId: 'request', decisionId: 'decision', actionId: 'action' }]);
  expect(f.counts()).toEqual({ admitted: 1, cancelled: 1 });
});
it('records invalid provider output only as a fixed terminal result without inspecting or retaining its contents', async () => {
  const f = fixture(); f.launch(); f.session.authorize('request');
  expect((await f.session.deliver('request', 'PRIVATE_PROVIDER_RESULT_CANARY'))?.reason).toBe('invalid_decision');
  expect(f.records.filter(record => record.kind === 'decision').map(record => record.payload)).toEqual([
    { requestId: 'request', reason: 'invalid_decision' }]);
  expect(JSON.stringify(f.records)).not.toContain('PRIVATE_PROVIDER_RESULT_CANARY'); expect(f.counts().admitted).toBe(0);
});
it('feeds the real strict recorder without missing parents even when actual admission precedes terminal metadata', async () => {
  let recorder!: CausalRecorder, trace!: SceneTrace;
  const sink: CausalSink = (kind, payload) => { expect(recorder.append(kind, payload)).toBe(true); };
  const f = fixture(sink, owner => {
    trace.record(1, 'admitted', f.now(), undefined, 'epoch', { origin: 'reactive', ...owner });
    trace.record(1, 'applied', f.now(), undefined, 'epoch', { origin: 'reactive', ...owner });
    trace.frame(2, 11, f.now());
  });
  recorder = new CausalRecorder({ now: f.now, wallNow: f.wall, epoch: () => 'epoch' });
  expect(recorder.start({ runId: 'test', mode: 'synthetic' })).toBe(true);
  trace = new SceneTrace(sink); trace.frame(1, 10, f.now()); f.launch(); f.session.authorize('request');
  await f.session.deliver('request', f.express()); f.observe('expression_changed');
  const bundle = recorder.snapshot(); expect(bundle.manifest?.incomplete).toBe(false);
  expect(bundle.manifest?.reasons).toEqual([]);
  expect(bundle.records.map(record => record.kind)).toEqual(expect.arrayContaining([
    'observation', 'event', 'request', 'authorization', 'execution', 'frame', 'decision', 'revocation']));
  expect(bundle.records.findIndex(record => record.kind === 'execution')).toBeLessThan(bundle.records.findIndex(record => record.kind === 'decision'));
  expect(JSON.stringify(bundle)).not.toMatch(/PRIVATE_SUMMARY_CANARY|durationMs|"summary"|"body"/);
});
