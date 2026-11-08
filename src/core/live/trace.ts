type Phase = 'received' | 'admitted' | 'rejected' | 'applied' | 'completed' | 'cancelled' | 'frame_submitted' | 'frame_changed_proxy';
type Entry = { turn: number; seq: number; phase: Phase; at: number; code?: string; frame?: number };
export class SceneTrace {
  private events: Entry[] = [];
  private turn = 0;
  private state = 'idle';
  private signature?: number;
  private pending?: { seq: number; baseline?: number; submitted: boolean };
  activity(state: string) {
    if (state === 'working' && ['idle', 'interrupted'].includes(this.state)) this.turn++;
    this.state = state;
  }
  record(seq: number, phase: Phase, at: number, code?: string) {
    if (!Number.isSafeInteger(seq) || seq < 0) return;
    const safeCode = code?.match(/^[a-z_]+/)?.[0];
    this.events.push({ turn: this.turn, seq, phase, at: Math.round(at), ...(safeCode ? { code: safeCode } : {}) });
    this.events.splice(0, Math.max(0, this.events.length - 64));
    if (phase === 'applied') this.pending = { seq, baseline: this.signature, submitted: false };
    if (phase === 'cancelled' && this.pending?.seq === seq) this.pending = undefined;
  }
  frame(frame: number, signature: number, at: number) {
    const pending = this.pending;
    if (pending) {
      if (!pending.submitted) { this.record(pending.seq, 'frame_submitted', at); this.events.at(-1)!.frame = frame; pending.submitted = true; }
      if (pending.baseline !== undefined && signature !== pending.baseline) {
        this.record(pending.seq, 'frame_changed_proxy', at); this.events.at(-1)!.frame = frame; this.pending = undefined;
      }
    }
    this.signature = signature;
  }
  reset() { this.pending = undefined; }
  snapshot() { return { turn: this.turn, events: this.events.map(event => ({ ...event })),
    interpretation: 'Frame submission and geometry hash changes are proxies; screenshots and relevance need separate evaluation.' }; }
}
