import type { Observation } from '../core/live/types';

// A historical reading, not a claim about the scene at response time.
export function chatObservation(snapshot: Observation, epoch: string, readAt: number, unavailable = false) {
  const ageMs = readAt - snapshot.capturedAt;
  const state = unavailable || !['tracking', 'absent'].includes(snapshot.camera) ? 'unavailable' :
    !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 1500 ? 'stale' : 'fresh';
  const source = { sessionId: snapshot.sessionId, seq: snapshot.seq, epoch, capturedAt: snapshot.capturedAt, readAt, ageMs: Number.isFinite(ageMs) && ageMs >= 0 ? ageMs : null, camera: snapshot.camera };
  if (state !== 'fresh') return { schemaVersion: 1, state, source, geometry: null };
  const user = snapshot.user;
  return { schemaVersion: 1, state, source, geometry: {
    facePresent: user.present, trackingStabilityScore: user.quality.score,
    position: user.position ? { ...user.position } : null, headDegrees: user.head ? { ...user.head } : null, facingScreen: user.facingScreen,
    expressionCoefficients: user.expression ? { ...user.expression } : null,
    handTrackingState: snapshot.hands?.trackingState ?? 'unavailable',
    hands: (snapshot.hands?.trackingState === 'tracked' ? snapshot.hands.entities : []).map(hand => ({ trackId: hand.trackId ?? null, handednessConfidence: hand.confidence,
      wristImageNormalized: { x: hand.landmarks[0].x, y: hand.landmarks[0].y } }))
  } };
}
