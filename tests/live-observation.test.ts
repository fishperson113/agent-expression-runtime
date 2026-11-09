import { expect, it } from 'vitest';
import Ajv from 'ajv';
import schema from '../src/contracts/live.schema.json';
import { FaceObservations, type FaceSample } from '../src/live/observation';
import { validateObservation } from '../src/core/live/observation';

function sample(present = true, smile = 0): FaceSample {
  return { landmarks: present ? Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })) : [],
    scores: { mouthSmileLeft: smile, mouthSmileRight: smile }, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], durationMs: 10, delegate: 'GPU' };
}
it('separates immediate tracking from one-second confirmed arrival and departure', () => {
  const observations = new FaceObservations('sample');
  expect(observations.update(sample(), 1000)).toEqual([]);
  expect(observations.snapshot.user.present).toBe(true);
  expect(observations.update(sample(), 1999)).toEqual([]);
  expect(observations.update(sample(), 2000).map(event => event.type)).toContain('user_arrived');
  observations.update(sample(false), 2100);
  expect(observations.snapshot.user.head).toBe(null);
  expect(observations.update(sample(false), 3100).map(event => event.type)).toContain('user_left');
  expect(validateObservation(observations.snapshot).camera).toBe('absent');
});
it('uses tracking stability as quality, smooths expression, and clears state on stop', () => {
  const observations = new FaceObservations('sample');
  observations.update(sample(), 1000); observations.update(sample(true, 1), 1010);
  expect(observations.snapshot.user.expression!.smile).toBeLessThan(0.2);
  expect(observations.snapshot.user.quality.basis).toBe('tracking-stability');
  expect(observations.snapshot.user.mouthMoving).toBe(false);
  observations.status('denied', 1100);
  expect(validateObservation(observations.snapshot).user.present).toBe(false);
  expect(observations.snapshot.user.expression).toBe(null);
});
it('does not make old camera measurements fresh when the Codex turn changes', () => {
  const observations = new FaceObservations('sample'); observations.update(sample(), 1000);
  observations.turn('working', 5000);
  expect(observations.snapshot.capturedAt).toBe(1000);
  expect(observations.snapshot.turn).toBe('working');
});

it('preserves versioned structured hand observations without inventing face presence', () => {
  const observations = new FaceObservations('hands');
  const handObservation = { v: 1 as const, trackingState: 'tracked' as const,
    coordinateSpace: 'image-normalized' as const, landmarkSchema: 'mediapipe-hand-21' as const,
    zMeaning: 'wrist-relative-image-width' as const, mirrored: false as const, sourceWidth: 640, sourceHeight: 480,
    entities: [{ detectionId: 0, handedness: 'Left' as const, confidence: 0.9,
      landmarks: Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: 0.5, z: -0.1 })) }] };
  observations.update({ ...sample(false), handObservation }, 1000);
  expect(validateObservation(observations.snapshot).hands).toEqual(handObservation);
  expect(new Ajv().compile(schema)(observations.snapshot)).toBe(true);
  expect(observations.snapshot.user.present).toBe(false);
  const invalid = structuredClone(observations.snapshot);
  invalid.hands!.entities[0].landmarks[0].x = NaN;
  expect(() => validateObservation(invalid)).toThrow();
  invalid.hands = { ...handObservation, v: 2 } as never;
  expect(() => validateObservation(invalid)).toThrow();
  observations.status('stopped', 1100);
  expect(validateObservation(observations.snapshot).hands).toBeUndefined();
});
