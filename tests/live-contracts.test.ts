import { expect, it } from 'vitest';
import Ajv from 'ajv';
import schema from '../src/contracts/live.schema.json';
import { validateObservation, ObservationStore } from '../src/core/live/observation';
import { unavailableUser, type Observation } from '../src/core/live/types';
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
