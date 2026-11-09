import type { CausalKind, CausalPayloads, CausalSink } from './causal-recorder-types';
type Phase = 'received' | 'admitted' | 'rejected' | 'applied' | 'completed' | 'cancelled' | 'frame_submitted' | 'frame_changed_proxy';
export type TraceAttribution = { origin?: 'native' | 'reactive' | 'ambient'; requestId?: string; decisionId?: string; actionId?: string };
type Entry = TraceAttribution & { turn: number; seq: number; epoch: string; phase: Phase; at: number; code?: string; frame?: number };
function attribution(value: TraceAttribution): TraceAttribution {
  const safe: TraceAttribution = {};
  if (['native', 'reactive', 'ambient'].includes(value.origin ?? '')) safe.origin = value.origin;
  for (const name of ['requestId', 'decisionId', 'actionId'] as const)
    if (typeof value[name] === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value[name]!)) safe[name] = value[name];
  return safe;
}
const sameAttribution = (a: TraceAttribution, b: TraceAttribution) =>
  a.origin === b.origin && a.requestId === b.requestId && a.decisionId === b.decisionId && a.actionId === b.actionId;
export class SceneTrace {
  private events: Entry[] = [];
  private turn = 0;
  private state = 'idle';
  private signature?: number;
  private pending?: { seq: number; epoch: string; baseline?: number; submitted: boolean; attribution: TraceAttribution };
  constructor(private recordSink?: CausalSink) {}
  setSink(sink?: CausalSink) { this.recordSink = sink; }
  private emit<K extends CausalKind>(kind: K, payload: CausalPayloads[K]) {
    if (!this.recordSink) return;
    try { this.recordSink(kind, structuredClone(payload)); } catch { /* Recording cannot affect rendering. */ }
  }
  activity(state: string) {
    if (state === 'working' && ['idle', 'interrupted'].includes(this.state)) this.turn++;
    this.state = state;
  }
  record(seq: number, phase: Phase, at: number, code?: string, epoch = 'local', owner: TraceAttribution = {}, frame?: number) {
    if (!Number.isSafeInteger(seq) || seq < 0) return;
    const safeCode = code?.match(/^[a-z_]+/)?.[0];
    const safeEpoch = /^[0-9a-f-]{36}$/i.test(epoch) ? epoch : 'local';
    const source = attribution(owner);
    const entry = { turn: this.turn, seq, epoch: safeEpoch, phase, at: Math.round(at), ...(safeCode ? { code: safeCode } : {}), ...source, ...(frame === undefined ? {} : { frame }) };
    this.events.push(entry);
    const { code: _code, ...execution } = entry; this.emit('execution', execution);
    this.events.splice(0, Math.max(0, this.events.length - 64));
    if (phase === 'applied') this.pending = { seq, epoch: safeEpoch, baseline: this.signature, submitted: false, attribution: source };
    if (phase === 'cancelled' && this.pending?.seq === seq && this.pending.epoch === safeEpoch && sameAttribution(source, this.pending.attribution)) this.pending = undefined;
  }
  frame(frame: number, signature: number, at: number) {
    const pending = this.pending;
    if (pending) {
      if (!pending.submitted) { this.record(pending.seq, 'frame_submitted', at, undefined, pending.epoch, pending.attribution, frame); pending.submitted = true; }
      if (pending.baseline !== undefined && signature !== pending.baseline) {
        this.record(pending.seq, 'frame_changed_proxy', at, undefined, pending.epoch, pending.attribution, frame); this.pending = undefined;
      }
    }
    this.emit('frame', { frame, signature, ...(pending?.attribution ?? {}) });
    this.signature = signature;
  }
  reset() { this.pending = undefined; }
  snapshot() { return { turn: this.turn, events: this.events.map(event => ({ ...event })),
    interpretation: 'Frame submission and geometry hash changes are proxies; screenshots and relevance need separate evaluation.' }; }
}
