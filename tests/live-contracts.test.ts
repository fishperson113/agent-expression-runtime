import { expect, it } from 'vitest';
import Ajv from 'ajv';
import schema from '../src/contracts/live.schema.json';
import { validateObservation, validateSourceEvent, eventKinds, ObservationStore } from '../src/core/live/observation';
import { unavailableUser, type Observation, type HandWireEvent } from '../src/core/live/types';
import { CausalRecorder } from '../src/core/live/causal-recorder';
import { signalValue } from '../src/core/live/signals';

export function observation(seq = 1, capturedAt = 1000): Observation {
  return { v: 1, sessionId: 'test', seq, capturedAt, camera: 'absent', user: unavailableUser(), turn: 'idle', summary: 'Chưa thấy người dùng.' };
}
it('agrees with the public schema and rejects malformed/unknown observations', () => {
  const validate = new Ajv().compile(schema), sample = observation();
  expect(validate(sample)).toBe(true); expect(validateObservation(sample)).toEqual(sample);
  expect(() => validateObservation({ ...sample, pixels: 'private' })).toThrow('live_fields');
  expect(() => validateObservation({ ...sample, capturedAt: NaN })).toThrow('live_range');
  expect(() => validateObservation({ ...sample, seq: 1.5 })).toThrow();
  expect(() => validateObservation({ ...sample, user: { ...sample.user, head: { yaw: 0, pitch: 0, roll: 0 } } })).toThrow('live_absent_fields');
});
it('bounds event history with independent non-consuming cursors and gap detection', () => {
  const store = new ObservationStore(1500, 2);
  for (let seq = 1; seq <= 3; seq++) store.ingest(observation(seq), [{ type: 'user_arrived', at: 1000 }], 1000);
  expect(store.read(0, 1000)).toMatchObject({ gap: true, cursor: 3 });
  expect(store.read(2, 1000).events.map(event => event.id)).toEqual([3]);
  expect(store.read(2, 1000).events.map(event => event.id)).toEqual([3]);
  expect(() => store.ingest(observation(2), [], 1000)).toThrow('live_stale_sequence');
  expect(() => store.ingest({ ...observation(4), sessionId: 'other' }, [], 1000)).toThrow('live_wrong_session');
});
it('turns stale values into unknown and resets session/cursor atomically', () => {
  const store = new ObservationStore(); store.ingest(observation(), [], 1000);
  expect(store.read(0, 2600)).toMatchObject({ stale: true, ageMs: 1600, snapshot: { camera: 'stale', user: { head: null } } });
  expect(signalValue('user.head.yaw', store.read(0, 2600).snapshot)).toBe(null);
  expect(signalValue('agent.output', null, 2)).toBe(1);
  store.reset(); expect(store.read(0, 1000).snapshot).toBe(null);
  store.ingest({ ...observation(), sessionId: 'other' }, [], 1000);
  expect(() => store.read(999, 1000)).toThrow('live_cursor');
});
it('keeps explicitly stale measurements stale even with a recent transport timestamp', () => {
  const store = new ObservationStore(); store.ingest({ ...observation(), camera: 'stale' }, [], 1000);
  expect(store.read(0, 1000).stale).toBe(true);
});

const handEvent = (): HandWireEvent => ({ type: 'hand_motion_started', at: 1000, eventVersion: 1, trackId: 'hand_1_1', sourceSeq: 77,
  observationSeq: 12, evidenceStartSeq: 10, stateRevision: 3, sourceGeneration: 1 });
it('preserves versioned hand evidence and keeps delivery cursor distinct from source sequence', () => {
  const store = new ObservationStore(), hand = handEvent();
  store.ingest(observation(12), [{ type: 'user_arrived', at: 1000 }, hand], 1000);
  expect(store.read(1, 1000).events).toEqual([{ ...hand, id: 2 }]);
  (store.read(1, 1000).events[0] as HandWireEvent).trackId = 'read_mutation';
  hand.trackId = 'changed'; expect(store.read(1, 1000).events[0]).toMatchObject({ trackId: 'hand_1_1', sourceSeq: 77, id: 2 });
  expect(() => store.ingest(observation(13), [handEvent()], 1000)).toThrow('live_event_sequence');
  store.ingest(observation(13), [{ ...handEvent(), sourceSeq: 78, observationSeq: 13 }], 1000);
  expect(store.read(2, 1000).events[0].id).toBe(3); expect(eventKinds).not.toContain('hand_motion_started');
});
it('fails closed on unknown hand schemas, incomplete evidence, source rollback and future frame claims', () => {
  for (const patch of [{ eventVersion: 2 }, { trackId: 'bad id' }, { evidenceStartSeq: 13 }, { sourceSeq: NaN }, { stateRevision: -1 },
    { sourceGeneration: 0.5 }, { pixels: 'private' }]) expect(() => validateSourceEvent({ ...handEvent(), ...patch })).toThrow();
  const missing = { ...handEvent() } as any; delete missing.sourceSeq; expect(() => validateSourceEvent(missing)).toThrow();
  const getter = Object.defineProperty({}, 'type', { get: () => { throw Error('getter must not run'); }, enumerable: true });
  expect(() => validateSourceEvent(getter)).toThrow('live_event');
  expect(() => new ObservationStore().ingest(observation(11), [handEvent()], 1000)).toThrow('live_hand_event');
  expect(validateSourceEvent({ type: 'user_arrived', at: 1000 })).toEqual({ type: 'user_arrived', at: 1000 });
  expect(validateSourceEvent({ type: 'user_arrived', at: 1000, sourceSeq: 70 })).toMatchObject({ sourceSeq: 70 });
});
it('records the complete hand wire evidence and flags evidence originating before consent without backfill', () => {
  const recorder = new CausalRecorder({ now: () => 0, wallNow: () => 1000, epoch: () => 'epoch' });
  const event = { ...handEvent(), sessionId: 'test', seq: 77 };
  recorder.start({ runId: 'hand', mode: 'synthetic' }); recorder.append('observation', observation(12));
  expect(recorder.append('event', event)).toBe(true); expect(recorder.status()?.reasons).toContain('missing_parent');
  expect(recorder.snapshot().records[1].payload).toEqual(event);
  recorder.clear(); recorder.start({ runId: 'full', mode: 'synthetic' });
  recorder.append('observation', observation(10)); recorder.append('observation', observation(12)); recorder.append('event', event);
  expect(recorder.status()?.incomplete).toBe(false);
  expect(recorder.append('event', { ...event, eventVersion: 2 } as any)).toBe(false);
});
