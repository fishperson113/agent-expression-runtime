import { expect, it } from 'vitest';
import { HandTracker } from '../src/core/live/hand-tracker';
import { FaceObservations } from '../src/live/observation';
import { validateObservation } from '../src/core/live/observation';
import type { HandObservation } from '../src/core/live/types';

const hand = (xs: number[], overrides: Partial<HandObservation> = {}): HandObservation => ({ v: 1,
  trackingState: xs.length ? 'tracked' : 'lost', coordinateSpace: 'image-normalized', landmarkSchema: 'mediapipe-hand-21',
  zMeaning: 'wrist-relative-image-width', mirrored: false, sourceWidth: 640, sourceHeight: 480,
  entities: xs.map((x, detectionId) => ({ detectionId, handedness: 'Left', confidence: 0.9,
    landmarks: Array.from({ length: 21 }, () => ({ x, y: 0.5, z: -0.1 })) })), ...overrides });
const byX = (value: HandObservation) => Object.fromEntries(value.entities.map(entity => [entity.landmarks[0].x, entity.trackId]));
it('associates geometry across detector reorder and handedness changes without changing raw coordinates', () => {
  const tracker = new HandTracker(), first = tracker.update(hand([0.2, 0.8]), 100)!;
  const source = hand([0.79, 0.21]); source.entities[0].handedness = 'Right';
  const next = tracker.update(source, 130)!;
  expect(byX(next)[0.21]).toBe(byX(first)[0.2]); expect(byX(next)[0.79]).toBe(byX(first)[0.8]);
  expect(next.entities.find(entity => entity.detectionId === 0)?.landmarks).toEqual(source.entities[0].landmarks);
  expect(next.primaryTrackId).toBe(first.primaryTrackId);
});
it('holds missing primary without selecting another hand and preserves only short nearby continuity', () => {
  const tracker = new HandTracker(), first = tracker.update(hand([0.2, 0.8]), 100)!;
  expect(tracker.update(hand([0.8]), 200)!.primaryTrackId).toBeNull();
  expect(tracker.update(hand([0.21, 0.8]), 250)!.primaryTrackId).toBe(first.primaryTrackId);
  expect(tracker.update(hand([0.8]), 300)!.primaryTrackId).toBeNull();
  expect(tracker.update(hand([0.8]), 510)!.primaryTrackId).toBe(byX(first)[0.8]);
  const far = tracker.update(hand([-0.1]), 550)!;
  expect(far.entities[0].trackId).not.toBe(first.primaryTrackId);
});
it('resets IDs after long loss, status reset, source discontinuity, clock rewind and ambiguous crossing', () => {
  const tracker = new HandTracker(), first = tracker.update(hand([0.4, 0.6]), 100)!;
  const crossing = tracker.update(hand([0.49, 0.51]), 130)!;
  expect(crossing.entities.every(entity => !first.entities.some(old => old.trackId === entity.trackId))).toBe(true);
  const resized = tracker.update(hand([0.49], { sourceWidth: 800 }), 150)!;
  expect(resized.entities[0].trackId).not.toBe(crossing.entities[0].trackId);
  const rewind = tracker.update(hand([0.49], { sourceWidth: 800 }), 140)!;
  expect(rewind.entities[0].trackId).not.toBe(resized.entities[0].trackId);
  const expired = tracker.update(hand([0.49], { sourceWidth: 800 }), 500)!;
  expect(expired.entities[0].trackId).not.toBe(rewind.entities[0].trackId);
  tracker.reset(); expect(tracker.update(hand([0.49]), 510)!.entities[0].trackId).not.toBe(expired.entities[0].trackId);
});
it('uses mirrored fixture coordinates as raw geometry and validates complete unique track references', () => {
  const tracker = new HandTracker(), left = tracker.update(hand([0.2]), 100)!;
  const mirroredFixture = tracker.update(hand([0.8]), 130)!;
  expect(mirroredFixture.mirrored).toBe(false); expect(mirroredFixture.entities[0].landmarks[0].x).toBe(0.8);
  expect(mirroredFixture.entities[0].trackId).not.toBe(left.entities[0].trackId);
  const observations = new FaceObservations('test');
  observations.update({ handObservation: hand([0.2, 0.8]), landmarks: [], scores: {}, matrix: [], durationMs: 1, delegate: 'CPU' }, 100);
  expect(validateObservation(observations.snapshot).hands?.primaryTrackId).toBeTruthy();
  const invalid = structuredClone(observations.snapshot); invalid.hands!.primaryTrackId = 'hand_9_9';
  expect(() => validateObservation(invalid)).toThrow('live_hand_primary');
  invalid.hands!.entities[0].trackId = invalid.hands!.entities[1].trackId;
  expect(() => validateObservation(invalid)).toThrow('live_hand_track');
  observations.status('stopped', 200); observations.update({ handObservation: hand([0.2]), landmarks: [], scores: {}, matrix: [], durationMs: 1, delegate: 'CPU' }, 210);
  expect(observations.snapshot.hands?.entities[0].trackId).not.toBe(invalid.hands!.entities[0].trackId);
});
