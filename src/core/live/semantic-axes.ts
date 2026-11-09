import type { HandReadSet, SemanticSnapshot } from './decision-types';
import type { Expressions, Observation } from './types';

type Band = 'low' | 'high' | 'unknown';
const fields: (keyof Expressions)[] = ['smile', 'browRaise', 'eyesClosed', 'mouthOpen'];
const band = (value: number | undefined, previous: Band): Band => value === undefined ? 'unknown' :
  value >= 0.6 ? 'high' : value <= 0.4 ? 'low' : previous;
/** Revisions describe semantic bands, not numerical frame equality or emotion. */
export class SemanticAxes {
  private orientationValue: boolean | null = null;
  private orientationRevision = 0;
  private bands: Band[] = fields.map(() => 'unknown');
  private expressionRevision = 0;
  private handKey = 'uninitialized';
  private handIdentityRevision = 0;
  private handMotion: number | null = null;
  clear() {
    if (this.orientationValue !== null) this.orientationRevision++;
    if (this.bands.some(value => value !== 'unknown')) this.expressionRevision++;
    if (this.handKey !== 'cleared') this.handIdentityRevision++;
    this.orientationValue = null; this.bands = fields.map(() => 'unknown'); this.handKey = 'cleared'; this.handMotion = null;
  }
  observe(snapshot: Observation, hand: HandReadSet | undefined, motion: number | null) {
    const orientation = snapshot.user.present ? snapshot.user.facingScreen : null;
    if (orientation !== this.orientationValue) { this.orientationValue = orientation; this.orientationRevision++; }
    const expression = snapshot.user.present ? snapshot.user.expression : null;
    const bands = fields.map((field, index) => band(expression?.[field], this.bands[index]));
    if (bands.some((value, index) => value !== this.bands[index])) { this.bands = bands; this.expressionRevision++; }
    const available = ['tracking', 'absent'].includes(snapshot.camera);
    const known = available && !!snapshot.hands && ['tracked', 'lost'].includes(snapshot.hands.trackingState) && !!hand;
    const key = JSON.stringify([snapshot.sessionId, !available ? 'source-unavailable' : !snapshot.hands ? 'hands-unavailable' :
      known ? `known:${snapshot.hands!.trackingState}` : `unknown:${snapshot.hands.trackingState}`, snapshot.hands?.primaryTrackId ?? null,
      hand?.sourceGeneration ?? null, hand?.primaryTrackId ?? null]);
    if (key !== this.handKey) { this.handKey = key; this.handIdentityRevision++; }
    this.handMotion = known && Number.isSafeInteger(motion) && motion! >= 0 ? motion : null;
  }
  snapshot(healthy: boolean): SemanticSnapshot {
    return Object.freeze({ orientation: healthy && this.orientationValue !== null ? this.orientationRevision : null,
      expression: healthy && this.bands.every(value => value !== 'unknown') ? this.expressionRevision : null,
      handMotion: healthy ? this.handMotion : null, handIdentity: this.handIdentityRevision });
  }
}
