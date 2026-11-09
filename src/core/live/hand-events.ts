import type { HandObservation, Observation } from './types';

type Point = { x: number; y: number };
type Sample = Point & { at: number; seq: number };
export type HandTemporalEvent = Readonly<{ eventVersion: 1;
  type: 'hand_appeared' | 'hand_lost' | 'hand_motion_started' | 'hand_motion_stopped';
  trackId: string; at: number; observationSeq: number; evidenceStartSeq: number; stateRevision: number; sourceGeneration: number }>;
export type HandEventState = Readonly<{ revision: number; sourceGeneration: number; primaryTrackId: string | null;
  confirmedTrackId: string | null; motion: 'unknown' | 'still' | 'moving' }>;
type Candidate = { id: string; since: number; seq: number; samples: number };
const pointDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Dev thresholds, not calibrated accuracy. Emits geometry transitions, never effects or intent. */
export class HandEventGate {
  private revision = 0;
  private generation = 0;
  private source?: string;
  private lastAt = -Infinity;
  private lastSeq = -1;
  private lastCapturedAt = -Infinity;
  private primary: string | null = null;
  private confirmed?: string;
  private candidate?: Candidate;
  private missing?: { since: number; seq: number };
  private motion: HandEventState['motion'] = 'unknown';
  private samples: Sample[] = [];
  private stillSince?: { at: number; seq: number };
  reset() {
    this.revision++; this.generation++; this.source = undefined; this.lastAt = -Infinity; this.lastSeq = -1; this.lastCapturedAt = -Infinity;
    this.primary = null; this.confirmed = undefined; this.candidate = undefined; this.missing = undefined;
    this.motion = 'unknown'; this.samples = []; this.stillSince = undefined;
  }
  state(): HandEventState {
    return Object.freeze({ revision: this.revision, sourceGeneration: this.generation, primaryTrackId: this.primary,
      confirmedTrackId: this.confirmed ?? null, motion: this.motion });
  }
  update(snapshot: Observation, monotonicAt: number): HandTemporalEvent[] {
    const input = this.input(snapshot, monotonicAt);
    if (!input) { if (this.source !== undefined) this.reset(); return []; }
    if (this.source === input.source && snapshot.seq <= this.lastSeq) return [];
    if (this.source !== input.source || monotonicAt <= this.lastAt || monotonicAt - this.lastAt > 300 ||
      snapshot.capturedAt < this.lastCapturedAt || snapshot.capturedAt - this.lastCapturedAt > 1500) this.reset();
    this.source = input.source; this.lastAt = monotonicAt; this.lastSeq = snapshot.seq; this.lastCapturedAt = snapshot.capturedAt;
    const next = input.hand?.trackId ?? null;
    if (next !== this.primary) { this.primary = next; this.revision++; this.samples = []; this.stillSince = undefined; }
    const events: HandTemporalEvent[] = [];
    this.presence(snapshot, monotonicAt, events);
    if (input.hand && this.confirmed === next) this.movement(input.hand.landmarks[0], snapshot, monotonicAt, events);
    return events;
  }
  private input(snapshot: Observation, at: number) {
    const hands = snapshot.hands;
    if (!Number.isFinite(at) || at < 0 || !Number.isSafeInteger(snapshot.seq) || snapshot.seq < 0 || (!Number.isFinite(snapshot.capturedAt) || snapshot.capturedAt < 0) ||
      !['tracking', 'absent'].includes(snapshot.camera) || !hands || hands.mirrored !== false || hands.coordinateSpace !== 'image-normalized' || !['tracked', 'lost'].includes(hands.trackingState)) return;
    const hand = hands.primaryTrackId ? hands.entities.find(entity => entity.trackId === hands.primaryTrackId) : undefined;
    if (hands.primaryTrackId && (!hand || hands.primaryTrackId.length > 64 || !/^hand_[0-9]+_[0-9]+$/.test(hands.primaryTrackId))) return;
    if (hand && (!hand.landmarks[0] || !['x', 'y'].every(axis => Number.isFinite(hand.landmarks[0][axis as 'x' | 'y'])))) return;
    return { source: `${snapshot.sessionId}:${hands.sourceWidth}:${hands.sourceHeight}:${hands.mirrored}`, hand };
  }
  private presence(snapshot: Observation, at: number, events: HandTemporalEvent[]) {
    if (this.primary && this.primary !== this.confirmed) {
      if (this.candidate?.id !== this.primary) this.candidate = { id: this.primary, since: at, seq: snapshot.seq, samples: 0 };
      this.candidate.samples++;
    } else this.candidate = undefined;
    if (this.confirmed && this.primary !== this.confirmed && snapshot.hands!.entities.some(hand => hand.trackId === this.confirmed)) {
      this.confirmed = undefined; this.motion = 'unknown'; this.samples = []; this.missing = undefined;
    }
    if (this.confirmed && this.primary !== this.confirmed) {
      this.missing ??= { since: at, seq: snapshot.seq };
      if (at - this.missing.since >= 300) {
        this.emit('hand_lost', this.confirmed, snapshot, this.missing.seq, events);
        this.confirmed = undefined; this.motion = 'unknown'; this.samples = []; this.missing = undefined;
      }
    } else this.missing = undefined;
    if (!this.confirmed && this.candidate && this.candidate.samples >= 3 && at - this.candidate.since >= 150) {
      this.confirmed = this.candidate.id; this.motion = 'still';
      this.emit('hand_appeared', this.confirmed, snapshot, this.candidate.seq, events); this.candidate = undefined;
    }
  }
  private movement(point: Point, snapshot: Observation, at: number, events: HandTemporalEvent[]) {
    if (!this.samples.length || at - this.samples[this.samples.length - 1].at >= 20) this.samples.push({ ...point, at, seq: snapshot.seq });
    this.samples = this.samples.filter(sample => at - sample.at <= 250).slice(-16);
    const first = this.samples[0], duration = at - first.at;
    if (duration < 150) return;
    const displacement = pointDistance(first, point), speed = displacement / (duration / 1000);
    if (this.motion === 'still' && displacement >= 0.04 && speed >= 0.12) {
      this.motion = 'moving'; this.stillSince = undefined;
      this.emit('hand_motion_started', this.confirmed!, snapshot, first.seq, events);
    } else if (this.motion === 'moving') {
      if (displacement <= 0.008 && speed <= 0.04) {
        this.stillSince ??= { at, seq: first.seq };
        if (at - this.stillSince.at >= 300) { this.motion = 'still'; this.emit('hand_motion_stopped', this.confirmed!, snapshot, this.stillSince.seq, events); this.stillSince = undefined; }
      } else this.stillSince = undefined;
    }
  }
  private emit(type: HandTemporalEvent['type'], trackId: string, snapshot: Observation, startSeq: number, events: HandTemporalEvent[]) {
    events.push(Object.freeze({ eventVersion: 1, type, trackId, at: snapshot.capturedAt, observationSeq: snapshot.seq,
      evidenceStartSeq: startSeq, stateRevision: ++this.revision, sourceGeneration: this.generation }));
  }
}
