import { expect, it } from 'vitest';
import { HandEventGate } from '../src/core/live/hand-events';
import { unavailableUser, type Observation } from '../src/core/live/types';
function fixture() {
  let seq = 0, at = 0; const gate = new HandEventGate();
  const sample = (x: number | null = 0.2, track = 'hand_1_1', dt = 50, other = false) => {
    at += dt;
    const snapshot: Observation = { v: 1, sessionId: 'source', seq: ++seq, capturedAt: 10000 + at, camera: 'absent', turn: 'idle', summary: '', user: unavailableUser(),
      hands: { v: 1, trackingState: x === null && !other ? 'lost' : 'tracked', coordinateSpace: 'image-normalized', landmarkSchema: 'mediapipe-hand-21',
        zMeaning: 'wrist-relative-image-width', mirrored: false, sourceWidth: 640, sourceHeight: 480, primaryTrackId: x === null ? null : track,
        entities: x === null ? [] : [{ detectionId: 0, trackId: track, handedness: 'Unknown', confidence: 0,
          landmarks: Array.from({ length: 21 }, () => ({ x, y: 0.5, z: 0 })) }] } };
    if (other) snapshot.hands!.entities.push({ detectionId: 1, trackId: 'hand_1_2', handedness: 'Left', confidence: 1,
      landmarks: Array.from({ length: 21 }, () => ({ x: 0.8, y: 0.5, z: 0 })) });
    return { snapshot, events: gate.update(snapshot, at), at };
  };
  const present = () => Array.from({ length: 4 }, () => sample()).flatMap(value => value.events);
  return { gate, sample, present };
}
it('debounces appearance/loss and changes absence prerequisites immediately when a hand returns', () => {
  const f = fixture(); expect(f.present().map(event => event.type)).toEqual(['hand_appeared']);
  const before = f.gate.state().revision;
  for (let i = 0; i < 3; i++) expect(f.sample(null).events).toEqual([]);
  expect(f.sample().events).toEqual([]); expect(f.gate.state().revision).toBeGreaterThan(before);
  const lost = Array.from({ length: 7 }, () => f.sample(null)).flatMap(value => value.events);
  expect(lost.map(event => event.type)).toEqual(['hand_lost']); const absentRevision = f.gate.state().revision;
  expect(f.sample().events).toEqual([]); expect(f.gate.state().revision).toBeGreaterThan(absentRevision);
  expect(f.gate.state().primaryTrackId).toBe('hand_1_1');
});
it('ignores stillness/jitter and slow drift without using handedness confidence as detection quality', () => {
  const f = fixture(); f.present(); const revision = f.gate.state().revision;
  for (let i = 0; i < 2400; i++) expect(f.sample(0.2 + (i % 2 ? 0.002 : -0.002)).events).toEqual([]);
  expect(f.gate.state().revision).toBe(revision); expect(f.gate.state().motion).toBe('still');
  for (let i = 0; i < 100; i++) expect(f.sample(0.2 + i * 0.0005).events).toEqual([]);
});
it('emits only motion boundaries, keeping continuing compatible frames valid', () => {
  const f = fixture(); f.present();
  const moving = Array.from({ length: 20 }, (_, i) => f.sample(0.2 + i * 0.01)).flatMap(value => value.events);
  expect(moving.map(event => event.type)).toEqual(['hand_motion_started']); const revision = f.gate.state().revision;
  for (let i = 20; i < 30; i++) expect(f.sample(0.2 + i * 0.01).events).toEqual([]);
  expect(f.gate.state().revision).toBe(revision);
  const stopped = Array.from({ length: 14 }, () => f.sample(0.49)).flatMap(value => value.events);
  expect(stopped.map(event => event.type)).toEqual(['hand_motion_stopped']);
  expect(stopped[0].evidenceStartSeq).toBeLessThan(stopped[0].observationSeq); expect(Object.isFrozen(stopped[0])).toBe(true);
});
it('does not substitute a second hand for an absent primary, and debounces a stable primary switch', () => {
  const f = fixture(); f.present();
  for (let i = 0; i < 3; i++) expect(f.sample(null, 'hand_1_1', 50, true).events).toEqual([]);
  expect(f.gate.state().primaryTrackId).toBeNull(); expect(f.sample().events).toEqual([]);
  const changed = Array.from({ length: 7 }, () => f.sample(0.8, 'hand_1_2')).flatMap(value => value.events);
  expect(changed.map(event => [event.type, event.trackId])).toEqual([['hand_lost', 'hand_1_1'], ['hand_appeared', 'hand_1_2']]);
});
it('resets on unavailable camera, source/clock discontinuity and ignores duplicate source sequences', () => {
  const f = fixture(); f.present(); const value = f.sample(); const before = f.gate.state();
  expect(f.gate.update(value.snapshot, value.at + 1)).toEqual([]); expect(f.gate.state()).toEqual(before);
  expect(f.gate.update({ ...value.snapshot, seq: value.snapshot.seq + 1, camera: 'stopped' }, value.at + 50)).toEqual([]);
  expect(f.gate.state().confirmedTrackId).toBeNull();
  const fresh = f.sample(); const generation = f.gate.state().sourceGeneration;
  expect(f.gate.update({ ...fresh.snapshot, seq: fresh.snapshot.seq + 1, sessionId: 'other' }, fresh.at + 50)).toEqual([]);
  expect(f.gate.state().sourceGeneration).toBeGreaterThan(generation);
  expect(f.gate.update({ ...fresh.snapshot, seq: fresh.snapshot.seq + 2, sessionId: 'other' }, fresh.at)).toEqual([]);
});

it('does not report a visible former primary as physically lost during a primary-role handover', () => {
  const f = fixture(); f.present(); const base = f.sample(0.2, 'hand_1_1', 50, true);
  const events = [];
  for (let i = 1; i <= 5; i++) events.push(...f.gate.update({ ...base.snapshot, seq: base.snapshot.seq + i,
    capturedAt: base.snapshot.capturedAt + i * 50, hands: { ...base.snapshot.hands!, primaryTrackId: 'hand_1_2' } }, base.at + i * 50));
  expect(events.map(event => [event.type, event.trackId])).toEqual([['hand_appeared', 'hand_1_2']]);
  expect(f.gate.state().motion).toBe('still');
});

it('treats capture-clock jumps as source discontinuities even when host monotonic time continues', () => {
  for (const offset of [-1, 2000]) {
    const f = fixture(); f.present(); const value = f.sample(); const generation = f.gate.state().sourceGeneration;
    expect(f.gate.update({ ...value.snapshot, seq: value.snapshot.seq + 1, capturedAt: value.snapshot.capturedAt + offset }, value.at + 50)).toEqual([]);
    expect(f.gate.state().sourceGeneration).toBeGreaterThan(generation); expect(f.gate.state().confirmedTrackId).toBeNull();
  }
});

it('keeps temporal evidence long enough at high input cadence while storing bounded decimated samples', () => {
  const f = fixture();
  const seen = Array.from({ length: 40 }, () => f.sample(0.2, 'hand_1_1', 5)).flatMap(value => value.events);
  expect(seen.map(event => event.type)).toEqual(['hand_appeared']);
  const moved = Array.from({ length: 200 }, (_, i) => f.sample(0.2 + i * 0.0015, 'hand_1_1', 5)).flatMap(value => value.events);
  expect(moved.map(event => event.type)).toEqual(['hand_motion_started']);
});
