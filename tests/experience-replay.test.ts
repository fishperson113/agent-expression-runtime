import { expect, it } from 'vitest';
import { HandGestures } from '../src/live/gestures';
import { FaceObservations, type FaceSample } from '../src/live/observation';

const classes = ['Open_Palm', 'Closed_Fist', 'Pointing_Up', 'Thumb_Up', 'Thumb_Down', 'Victory', 'ILoveYou'];

it.each(classes)('Q02: %s requires confidence and a full dwell, not just repeated frames', categoryName => {
  const hand = new HandGestures();
  const input = (score: number) => [{ categoryName, score }];
  expect(hand.update(input(0.749), 0)).toBeNull();
  expect(hand.update(input(0.75), 100)).toBeNull();
  expect(hand.update(input(0.75), 349)).toBeNull();
  expect(hand.update(input(0.75), 350)).toBeTypeOf('string');
  expect(hand.label(850)).toBeTypeOf('string');
  expect(hand.label(851)).toBeNull();
  expect(hand.update(input(0.75), 1000)).toBeNull();
  expect(hand.update(input(0.75), 1250)).toBeTypeOf('string');
  expect(hand.update([], 1251)).toBeNull();
});

function face(present: boolean, phase: number): FaceSample {
  return { landmarks: present ? Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })) : [],
    scores: { mouthSmileLeft: phase % 2, mouthSmileRight: phase % 2 },
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], durationMs: 10, delegate: 'synthetic' };
}

function replay() {
  const observations = new FaceObservations('qa-synthetic-9011');
  observations.status('stopped', 0);
  const events: string[] = [], statuses: string[] = [];
  for (let at = 100; at <= 1_200_000; at += 100) {
    const phase = Math.floor(at / 10_000);
    events.push(...observations.update(face(phase % 3 !== 0, phase), at).map(event => event.type));
    if (at % 60_000 === 0) {
      observations.update(face(true, phase), at);
      expect(observations.snapshot.user.expression).not.toBeNull();
      expect(observations.snapshot.user.head).not.toBeNull();
      expect(observations.snapshot.user.position).not.toBeNull();
      const status = (['stopped', 'denied', 'error'] as const)[Math.floor(at / 60_000) % 3];
      observations.status(status, at); statuses.push(status);
      expect(observations.snapshot.user.present).toBe(false);
      expect(observations.snapshot.user.expression).toBeNull();
      expect(observations.snapshot.user.head).toBeNull();
      expect(observations.snapshot.user.position).toBeNull();
    }
  }
  return { events, statuses, snapshot: observations.snapshot };
}

it('Q04: twenty virtual minutes reproduce dropout/recovery without retained private measurements', () => {
  const first = replay(), second = replay();
  expect(first).toEqual(second);
  expect(first.events).toContain('user_arrived');
  expect(first.events).toContain('user_left');
  expect(new Set(first.statuses)).toEqual(new Set(['stopped', 'denied', 'error']));
  expect(first.events.length).toBeLessThan(1000);
  expect(first.snapshot.capturedAt).toBe(1_200_000);
  expect(first.snapshot.user.expression).toBeNull();
});
