import type { HandReadSet } from './decision-types';
import type { HandWireEvent, Observation } from './types';

type Sample = { source: string; track: string; generation: number; at: number; capturedAt: number; x: number; y: number };
type Reacquire = Sample & { samples: number };
const near = (a: Sample, b: Sample) => Math.hypot(a.x - b.x, a.y - b.y) <= 0.04;
function sample(snapshot: Observation, at: number, state?: HandReadSet): Sample | undefined {
  const hands = snapshot.hands;
  if (!state || !Number.isFinite(at) || at < 0 || !['tracking', 'absent'].includes(snapshot.camera) ||
      hands?.trackingState !== 'tracked' || hands.entities.length !== 1 || hands.mirrored !== false ||
      hands.coordinateSpace !== 'image-normalized' || !hands.primaryTrackId || state.primaryTrackId !== hands.primaryTrackId) return;
  const hand = hands.entities[0], wrist = hand.landmarks[0];
  if (hand.trackId !== hands.primaryTrackId || !wrist || !Number.isFinite(wrist.x) || !Number.isFinite(wrist.y)) return;
  return { source: JSON.stringify([snapshot.sessionId, hands.sourceWidth, hands.sourceHeight, hands.mirrored]),
    track: hands.primaryTrackId, generation: state.sourceGeneration, at, capturedAt: snapshot.capturedAt, x: wrist.x, y: wrist.y };
}

/** Opportunity memory only: never establishes identity or extends tracking/owner leases. */
export class HandOpportunityMemory {
  private previous?: Sample;
  private confirmed?: Sample;
  private reacquire?: Reacquire;
  private stable?: Reacquire;
  private suppressed = 0;
  private last?: { reason: 'technical_hand_reacquire'; observationSeq: number; sourceGeneration: number };
  reset() { this.previous = this.confirmed = this.reacquire = this.stable = undefined; }
  observe(snapshot: Observation, at: number, state?: HandReadSet) {
    const next = sample(snapshot, at, state), old = this.previous;
    if (!next) { this.reset(); return; }
    if (old) this.advance(old, next);
    this.previous = next;
    this.rebuildBaseline(next);
  }
  private rebuildBaseline(next: Sample) {
    const stable = this.stable;
    if (!stable || stable.source !== next.source || stable.track !== next.track || stable.generation !== next.generation ||
        next.at - stable.at > 1500 || !near(next, stable)) this.stable = { ...next, samples: 1 };
    else stable.samples = Math.min(3, stable.samples + 1);
    if (this.stable!.samples >= 3 && next.at - this.stable!.at >= 150) this.confirmed = next;
  }
  private advance(old: Sample, next: Sample) {
    const gap = next.at - old.at, capturedGap = next.capturedAt - old.capturedAt;
    if (next.source !== old.source || gap <= 0 || gap > 1500 || capturedGap <= 0 || capturedGap > 1500) {
      this.reset(); return;
    }
    if (next.generation !== old.generation) {
      this.reacquire = gap > 300 && next.generation === old.generation + 1 &&
        this.confirmed?.generation === old.generation && this.confirmed.track === old.track && near(old, next)
        ? { ...next, x: old.x, y: old.y, samples: 0 } : undefined;
      this.confirmed = undefined;
    } else if (next.track !== old.track || gap > 300) { this.confirmed = this.reacquire = this.stable = undefined; }
    if (this.reacquire) {
      if (next.source !== this.reacquire.source || next.track !== this.reacquire.track ||
          next.generation !== this.reacquire.generation || next.at - this.reacquire.at > 1500 || !near(next, this.reacquire)) this.reacquire = undefined;
      else this.reacquire.samples = Math.min(3, this.reacquire.samples + 1);
    }
  }
  suppress(event: HandWireEvent): boolean {
    if (event.type !== 'hand_appeared') return false;
    const current = this.previous, candidate = this.reacquire;
    if (!current || current.track !== event.trackId || current.generation !== event.sourceGeneration) return false;
    const suppress = !!candidate && candidate.samples >= 3 && current.at - candidate.at >= 150;
    this.confirmed = current; this.reacquire = undefined;
    if (suppress) {
      this.suppressed = Math.min(Number.MAX_SAFE_INTEGER, this.suppressed + 1);
      this.last = { reason: 'technical_hand_reacquire', observationSeq: event.observationSeq, sourceGeneration: event.sourceGeneration };
    }
    return suppress;
  }
  status() { return { suppressed: this.suppressed, last: this.last ? { ...this.last } : null }; }
}
