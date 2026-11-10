import { HandEventGate, type HandTemporalEvent } from '../core/live/hand-events';
import { freezeHandReadSet, type HandReadSet } from '../core/live/decision-types';
import { validateSourceEvent } from '../core/live/observation';
import type { LiveEventKind, LiveSourceEvent, Observation } from '../core/live/types';

type FaceCue = { type: LiveEventKind; at: number };
/** One source sequence for face and hand cues. Only sample() advances temporal evidence. */
export class HandEventSource {
  private gate = new HandEventGate();
  private sequence = 0;
  private enabled = false;
  private resets = 0;
  private capturedAt?: number;
  private sessionId?: string;
  constructor(private now: () => number) {}
  configure(enabled: boolean) { if (enabled !== this.enabled) { this.enabled = enabled; this.reset(); } }
  reset() { this.resets++; this.gate.reset(); this.capturedAt = undefined; this.sessionId = undefined; }
  get resetVersion() { return this.resets; }
  handState(): HandReadSet | undefined {
    if (!this.enabled) return;
    const state = this.gate.state();
    return freezeHandReadSet({ stateRevision: state.revision, sourceGeneration: state.sourceGeneration, primaryTrackId: state.primaryTrackId });
  }
  handMotion(): number | null {
    const state = this.gate.state();
    return this.enabled && state.primaryTrackId !== null && state.primaryTrackId === state.confirmedTrackId && state.motion !== 'unknown' ? state.revision : null;
  }
  sample(snapshot: Observation, face: FaceCue[]): LiveSourceEvent[] {
    const fresh = snapshot.sessionId !== this.sessionId || snapshot.capturedAt !== this.capturedAt;
    this.sessionId = snapshot.sessionId; this.capturedAt = snapshot.capturedAt;
    const hands = this.enabled && fresh ? this.gate.update(snapshot, this.now()) : [];
    return this.publish([...face, ...hands]);
  }
  publish(cues: (FaceCue | HandTemporalEvent)[]): LiveSourceEvent[] {
    return cues.map(cue => {
      if (this.sequence >= Number.MAX_SAFE_INTEGER) throw Error('source_sequence_exhausted');
      return validateSourceEvent({ ...cue, sourceSeq: ++this.sequence });
    });
  }
}
