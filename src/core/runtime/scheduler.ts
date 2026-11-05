import type { BodyState, Clock, DiagnosticsSink, RendererSink } from '../ports';
import type { Compiled, ProgramIR, StateIR, Op } from './ir';
import type { Property, Value } from '../ast/types';
export const initialState = (): BodyState => ({
  shape: 'sphere',
  shapeWeights: [1, 0, 0, 0],
  flow: 'orbit',
  flowStrength: 0.15,
  color: '#79e6d3',
  brightness: 0.65,
  pointSize: 2,
  dispersion: 0.12,
});
const ease = (t: number, e: string) => (e === 'linear' ? t : t * t * (3 - 2 * t));
const mix = (a: Value, b: Value, t: number): Value =>
  typeof a === 'number' && typeof b === 'number' ? a + (b - a) * t : t >= 1 ? b : a;
type Active = {
  ir: ProgramIR;
  start: number;
  origins: Map<Op, Value>;
  strengths: Map<Op, number>;
  weights: Map<Op, number[]>;
  completed: Set<Op>;
  applied: boolean;
};
type Blend = { from: number; to: number; start: number; duration: number; easing: string };
export class Scheduler {
  epoch = 'idle';
  state = initialState();
  private lastSeq = -1;
  private active?: Active;
  private queue: ProgramIR[] = [];
  private baseline = { brightness: 0.65, pointSize: 2, dispersion: 0.12 };
  private blends = new Map<Property, Blend>();
  private owned = new Set<Property>();
  private admissions: number[] = [];
  private stateFeedback: { ir: StateIR; at: number; applied: boolean }[] = [];
  constructor(
    private clock: Clock,
    private sink: RendererSink,
    private diagnostics: DiagnosticsSink,
    private feedback?: (status: 'applied' | 'completed', ir: ProgramIR | StateIR) => void,
  ) {}
  get queueDepth() {
    return this.queue.length;
  }
  get busy() {
    return !!this.active;
  }
  cancel(epoch: string) {
    this.tick();
    this.epoch = epoch;
    this.lastSeq = -1;
    this.active = undefined;
    this.queue = [];
    this.stateFeedback = [];
    this.admissions = [];
    this.owned.clear();
    for (const [p, to] of Object.entries(this.baseline))
      this.blend(p as Property, to, 250, 'smoothstep');
  }
  admit(ir: Compiled): string {
    const reject = (code: string) => {
      this.diagnostics.count(code);
      return code;
    };
    const now = this.clock.now();
    if (ir.epoch !== this.epoch) return reject('stale_epoch');
    if (ir.seq <= this.lastSeq) return reject('stale_seq');
    if (ir.kind === 'define') {
      this.lastSeq = ir.seq;
      return 'defined';
    }
    if (ir.deadlineAt !== undefined && now > ir.deadlineAt) return reject('admission_timeout');
    if (now - ir.receivedAt > ir.ttlMs) return reject('expired');
    this.admissions = this.admissions.filter((t) => now - t < 1000);
    if (this.admissions.length >= 10) return reject('rate_limited');
    this.admissions.push(now);
    if (ir.kind === 'state') {
      this.lastSeq = ir.seq;
      this.applyBaseline(ir);
      this.stateFeedback.push({ ir, at: now, applied: false });
      return 'state';
    }
    if (ir.policy === 'append' && this.active && this.queue.length >= 8)
      return reject('queue_full');
    this.tick();
    this.lastSeq = ir.seq;
    if (ir.policy === 'replace') {
      this.active = undefined;
      this.queue = [];
      this.release();
    }
    if (!this.active) this.start(ir, now);
    else this.queue.push(ir);
    return 'accepted';
  }
  private applyBaseline(ir: StateIR) {
    for (const [key, value] of Object.entries(ir.patch)) {
      const p = key as keyof typeof this.baseline;
      this.baseline[p] = value!;
      if (!this.owned.has(p)) this.blend(p, value!, ir.duration, ir.easing);
    }
  }
  private blend(p: Property, to: number, duration: number, easing: string) {
    this.blends.set(p, {
      from: Number(this.state[p]),
      to,
      start: this.clock.now(),
      duration,
      easing,
    });
  }
  private start(ir: ProgramIR, start: number) {
    this.active = {
      ir,
      start,
      origins: new Map(),
      strengths: new Map(),
      weights: new Map(),
      completed: new Set(),
      applied: false,
    };
  }
  private release() {
    for (const p of this.owned) {
      if (p in this.baseline)
        this.blend(p, this.baseline[p as keyof typeof this.baseline], 250, 'smoothstep');
    }
    this.owned.clear();
  }
  tick() {
    const now = this.clock.now();
    // At most nine programs can be visited after restore; no unbounded catch-up.
    for (let attempts = 0; attempts < 9; attempts++) {
      const a = this.active;
      if (!a) break;
      if (a.ir.epoch !== this.epoch) {
        this.active = undefined;
        break;
      }
      const elapsed = now - a.start;
      const writing = new Set<Property>();
      if (!a.applied) {
        a.applied = true;
        this.feedback?.('applied', a.ir);
      }
      for (const op of a.ir.ops) {
        if (elapsed < op.at || a.completed.has(op)) continue;
        if (!a.origins.has(op)) {
          a.origins.set(op, this.state[op.property]);
          a.strengths.set(op, this.state.flowStrength);
          a.weights.set(op, [...this.state.shapeWeights]);
          this.blends.delete(op.property);
        }
        const t = ease(
          op.duration === 0 ? 1 : Math.min(1, (elapsed - op.at) / op.duration),
          op.easing,
        );
        this.state[op.property] = mix(a.origins.get(op)!, op.value, t);
        if (op.property === 'shape') {
          const target = ['sphere', 'ring', 'wave', 'cloud'].indexOf(String(op.value));
          this.state.shapeWeights = a.weights
            .get(op)!
            .map((w, i) => w + ((i === target ? 1 : 0) - w) * t);
          this.state.shape = op.value;
        }
        if (op.property === 'flow') this.state.flow = op.value;
        if (op.property === 'color') {
          const aColor = parseInt(String(a.origins.get(op)).slice(1), 16),
            bColor = parseInt(String(op.value).slice(1), 16);
          let c = 0;
          for (const shift of [16, 8, 0]) {
            const from = ((aColor >> shift) & 255) / 255,
              to = ((bColor >> shift) & 255) / 255;
            const srgb = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
            const v = srgb(from) + (srgb(to) - srgb(from)) * t;
            const encoded = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
            c |= Math.round(encoded * 255) << shift;
          }
          this.state.color = '#' + c.toString(16).padStart(6, '0');
        }
        if (op.property === 'flow')
          this.state.flowStrength =
            a.strengths.get(op)! + (op.strength! - a.strengths.get(op)!) * t;
        if (elapsed < op.at + op.duration) writing.add(op.property);
        else a.completed.add(op);
      }
      for (const p of this.owned)
        if (!writing.has(p) && p in this.baseline)
          this.blend(p, this.baseline[p as keyof typeof this.baseline], 250, 'smoothstep');
      this.owned = writing;
      if (elapsed < a.ir.duration) break;
      this.release();
      this.feedback?.('completed', a.ir);
      this.active = undefined;
      while (this.queue.length) {
        const next = this.queue.shift()!;
        if (now - next.receivedAt > next.ttlMs) {
          this.diagnostics.count('expired');
          continue;
        }
        this.start(next, now);
        break;
      }
    }
    for (const [p, b] of this.blends) {
      const t = ease(b.duration === 0 ? 1 : Math.min(1, (now - b.start) / b.duration), b.easing);
      this.state[p] = b.from + (b.to - b.from) * t;
      if (t >= 1) this.blends.delete(p);
    }
    this.stateFeedback = this.stateFeedback.filter((f) => {
      if (!f.applied) {
        f.applied = true;
        this.feedback?.('applied', f.ir);
      }
      if (now >= f.at + f.ir.duration) {
        this.feedback?.('completed', f.ir);
        return false;
      }
      return true;
    });
    this.sink.apply({ ...this.state, shapeWeights: [...this.state.shapeWeights] }, now);
  }
  dispose() {
    this.active = undefined;
    this.queue = [];
    this.sink.dispose();
  }
}
