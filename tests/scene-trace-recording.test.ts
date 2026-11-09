import { expect, it } from 'vitest';
import { SceneTrace } from '../src/core/live/trace';
import type { CausalKind, CausalSink } from '../src/core/live/causal-recorder-types';

it('emits fully populated frame records and keeps admission distinct from execution and frame proxies', () => {
  const events: { kind: CausalKind; payload: any }[] = [];
  const sink: CausalSink = (kind, payload) => events.push({ kind, payload });
  const trace = new SceneTrace(sink), owner = { origin: 'reactive' as const, requestId: 'request', decisionId: 'decision', actionId: 'action' };
  trace.frame(1, 10, 0); trace.record(7, 'admitted', 1, undefined, 'local', owner);
  expect(events.filter(event => event.kind === 'execution').map(event => event.payload.phase)).toEqual(['admitted']);
  trace.record(7, 'applied', 2, undefined, 'local', owner); trace.frame(2, 11, 3);
  expect(events.filter(event => event.kind === 'execution' && event.payload.phase.startsWith('frame_')).map(event => event.payload.frame)).toEqual([2, 2]);
  expect(events.filter(event => event.kind === 'frame').at(-1)?.payload).toEqual({ frame: 2, signature: 11, ...owner });
  trace.record(8, 'rejected', 4, 'private_error raw canary', 'local', owner);
  expect(JSON.stringify(events)).not.toMatch(/private_error|canary|"code"/);
});
it('does not attribute later frames to cancelled work and catches failing or mutating sinks', () => {
  const baseline = new SceneTrace(), recorded = new SceneTrace((_kind, value) => { (value as any).seq = 999; throw Error('quota'); });
  for (const trace of [baseline, recorded]) {
    trace.frame(1, 10, 0); trace.record(1, 'applied', 1, undefined, 'local', { origin: 'reactive', actionId: 'action' });
    trace.record(1, 'cancelled', 2, undefined, 'local', { origin: 'reactive', actionId: 'action' }); trace.frame(2, 11, 3);
  }
  expect(recorded.snapshot()).toEqual(baseline.snapshot());
  expect(recorded.snapshot().events.some(event => event.phase === 'frame_changed_proxy')).toBe(false);
});
it('supports an optional sink setter without changing the Body constructor or trace retention', () => {
  const recorded: unknown[] = [], trace = new SceneTrace();
  trace.record(1, 'received', 0); trace.setSink((kind, payload) => { recorded.push({ kind, payload }); });
  trace.record(1, 'admitted', 1); trace.setSink(); trace.record(1, 'applied', 2);
  expect(recorded).toHaveLength(1); expect(trace.snapshot().events.map(event => event.phase)).toEqual(['received', 'admitted', 'applied']);
});
