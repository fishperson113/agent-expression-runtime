import { expect, it } from 'vitest';
import { SemanticAxes } from '../src/core/live/semantic-axes';
import { unavailableUser, type Observation } from '../src/core/live/types';
const snapshot = (): Observation => ({ v: 1, sessionId: 'source', seq: 1, capturedAt: 1000, camera: 'tracking', turn: 'idle', summary: '',
  user: { ...unavailableUser(), present: true, facingScreen: true, expression: { smile: 0.2, browRaise: 0.2, eyesClosed: 0.2, mouthOpen: 0.2 } } });
it('tracks immediate orientation and hysteretic expression bands rather than frame equality', () => {
  const axes = new SemanticAxes(), value = snapshot(); axes.observe(value, undefined, null); const first = axes.snapshot(true);
  for (let i = 0; i < 100; i++) { value.seq++; value.user.expression!.smile = 0.2 + i % 2 * 0.02; axes.observe(value, undefined, null); }
  expect(axes.snapshot(true)).toEqual(first);
  value.user.facingScreen = false; axes.observe(value, undefined, null); expect(axes.snapshot(true).orientation).toBeGreaterThan(first.orientation!);
  value.user.expression!.smile = 0.61; axes.observe(value, undefined, null); const high = axes.snapshot(true).expression;
  value.user.expression!.smile = 0.5; axes.observe(value, undefined, null); expect(axes.snapshot(true).expression).toBe(high);
  value.user.expression!.smile = 0.39; axes.observe(value, undefined, null); expect(axes.snapshot(true).expression).toBeGreaterThan(high!);
});
it('does not reuse selected-axis revisions through unknown-to-known round trips', () => {
  const axes = new SemanticAxes(), value = snapshot(); axes.observe(value, undefined, null); const before = axes.snapshot(true);
  value.user.facingScreen = null; value.user.expression = null; axes.observe(value, undefined, null);
  expect(axes.snapshot(true).orientation).toBeNull(); expect(axes.snapshot(true).expression).toBeNull();
  axes.observe(snapshot(), undefined, null); const after = axes.snapshot(true);
  expect(after.orientation).toBeGreaterThan(before.orientation!); expect(after.expression).toBeGreaterThan(before.expression!);
});
it('always exposes a non-null hand identity history and latches unavailable, loss/return and source transitions', () => {
  const axes = new SemanticAxes(), value = snapshot(); axes.observe(value, undefined, null); const absent = axes.snapshot(true).handIdentity;
  expect(Number.isSafeInteger(absent)).toBe(true); expect(axes.snapshot(false).handIdentity).toBe(absent);
  value.hands = { v: 1, trackingState: 'tracked', coordinateSpace: 'image-normalized', landmarkSchema: 'mediapipe-hand-21',
    zMeaning: 'wrist-relative-image-width', mirrored: false, sourceWidth: 640, sourceHeight: 480, primaryTrackId: 'hand_1_1',
    entities: [{ detectionId: 0, trackId: 'hand_1_1', handedness: 'Unknown', confidence: 0, landmarks: Array(21).fill({ x: 0.2, y: 0.5, z: 0 }) }] };
  const tracked = structuredClone(value.hands);
  const hand = { stateRevision: 10, sourceGeneration: 7, primaryTrackId: 'hand_1_1' }; axes.observe(value, hand, 10);
  const known = axes.snapshot(true); expect(known.handIdentity).toBeGreaterThan(absent); expect(known.handMotion).toBe(10);
  value.hands.trackingState = 'lost'; value.hands.primaryTrackId = null; value.hands.entities = [];
  axes.observe(value, { ...hand, primaryTrackId: null }, null); const lost = axes.snapshot(true); expect(lost.handMotion).toBeNull();
  value.hands = tracked; axes.observe(value, hand, 12); expect(axes.snapshot(true).handIdentity).toBeGreaterThan(lost.handIdentity);
  const returned = axes.snapshot(true).handIdentity; delete value.hands; axes.observe(value, hand, 12);
  expect(axes.snapshot(true).handMotion).toBeNull(); expect(axes.snapshot(true).handIdentity).toBeGreaterThan(returned);
  const unknown = axes.snapshot(true).handIdentity; axes.observe(value, { ...hand, sourceGeneration: 8 }, null);
  expect(axes.snapshot(true).handIdentity).toBeGreaterThan(unknown);
});
