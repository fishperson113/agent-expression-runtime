import type { Clock, DiagnosticsSink, RendererSink } from '../ports';
import type { Compiled, ProgramIR, StateIR, Op } from './ir';
import type { Property, Value } from '../ast/types';
import { capability } from '../../primitives/registry';
import { ParticleFormation } from '../geometry/morph';
import type { Sculpture } from '../geometry/types';
import { PresenceMotion, type PresenceState } from './presence';
export const initialState = (): PresenceState => ({
  shape: 'sphere',
  shapeWeights: capability.shapes.map(name => Number(name === 'sphere')),
  flow: 'orbit',
  flowStrength: 0.15,
  flowWeights: capability.fields.map(name => Number(name === 'orbit')),
  color: '#79e6d3',
  brightness: 0.65,
  pointSize: 2,
  dispersion: 0.12,
  rise: 0,
  advance: 0,
  spread: 1,
  grow: 1,
  arcOffset: 0,
  effortFlow: 0,
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
  flowWeights: Map<Op, number[]>;
  completed: Set<Op>;
  applied: boolean;
};
const restPosture = { rise: 0, advance: 0, spread: 1, grow: 1, arcOffset: 0 };
type Blend = { from: number; to: number; start: number; duration: number; easing: string };
export class Scheduler {
  private formation: ParticleFormation;
  private presence = new PresenceMotion();
  private renderAt?: number;
  private renderTime = 0;
  epoch = 'idle';
  state = initialState();
  private lastSeq = -1;
  private active?: Active;
  private queue: ProgramIR[] = [];
  private baseline = { brightness: 0.65, pointSize: 2, dispersion: 0.12, effortFlow: 0, ...restPosture };
  private blends = new Map<Property, Blend>();
  private owned = new Set<Property>();
  private admissions: number[] = [];
  private stateFeedback: { ir: StateIR; at: number; applied: boolean }[] = [];
  constructor(
    private clock: Clock,
    private sink: RendererSink,
    private diagnostics: DiagnosticsSink,
    private feedback?: (
      status: 'applied' | 'completed' | 'cancelled',
      ir: ProgramIR | StateIR,
    ) => void,
    particleCount = capability.assembly.particles,
    restingStyle?: { brightness: number; pointSize: number; dispersion: number },
  ) {
    this.formation = new ParticleFormation(particleCount);
    if (restingStyle) { Object.assign(this.baseline, restingStyle); Object.assign(this.state, restingStyle); }
  }
  get queueDepth() {
    return this.queue.length;
  }
  get busy() {
    return !!this.active;
  }
  cancel(epoch: string, advance = true) {
    if (advance) this.tick();
    this.formation.freeze(this.clock.now());
    if (this.active) this.feedback?.('cancelled', this.active.ir);
    for (const ir of this.queue) this.feedback?.('cancelled', ir);
    for (const f of this.stateFeedback) this.feedback?.('cancelled', f.ir);
    this.epoch = epoch;
    this.lastSeq = -1;
    this.active = undefined;
    this.queue = [];
    this.stateFeedback = [];
    this.admissions = [];
    this.owned.clear();
    Object.assign(this.baseline, restPosture);
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
    if (ir.deadlineAt !== undefined && now > ir.deadlineAt) return reject('admission_timeout');
    if (now - ir.receivedAt > ir.ttlMs) return reject('expired');
    this.admissions = this.admissions.filter((t) => now - t < 1000);
    if (this.admissions.length >= 10) return reject('rate_limited');
    if (ir.kind === 'define') {
      this.admissions.push(now);
      this.lastSeq = ir.seq;
      return 'defined';
    }
    if (ir.kind === 'state') {
      this.admissions.push(now);
      this.lastSeq = ir.seq;
      this.stateFeedback = this.stateFeedback.filter((f) => {
        if (Object.keys(ir.patch).some((p) => p in f.ir.patch)) {
          this.feedback?.('cancelled', f.ir);
          return false;
        }
        return true;
      });
      this.applyBaseline(ir);
      this.stateFeedback.push({ ir, at: now, applied: false });
      return 'state';
    }
    if (ir.policy === 'append' && this.active && this.queue.length >= 8)
      return reject('queue_full');
    this.admissions.push(now);
    this.tick();
    this.lastSeq = ir.seq;
    if (ir.policy === 'replace') {
      if (this.active) this.feedback?.('cancelled', this.active.ir);
      for (const queued of this.queue) this.feedback?.('cancelled', queued);
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
      flowWeights: new Map(),
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
  private effortPosition(a: Active, op: Op, t: number) {
    if (!op.effort?.weight || !['rise', 'advance', 'spread', 'grow'].includes(op.property)) return;
    const value = Number(this.state[op.property]) + Math.sin(Math.PI * t) * op.effort.weight *
      0.4 * (Number(op.value) - Number(a.origins.get(op)!));
    const position = ['rise', 'advance'].includes(op.property);
    this.state[op.property] = Math.max(position ? -1 : 0.25, Math.min(position ? 1 : 2, value));
  }
  private sampleColor(a: Active, op: Op, t: number) {
    const aColor = parseInt(String(a.origins.get(op)).slice(1), 16);
    const bColor = parseInt(String(op.value).slice(1), 16);
    const srgb = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    let color = 0;
    for (const shift of [16, 8, 0]) {
      const from = ((aColor >> shift) & 255) / 255, to = ((bColor >> shift) & 255) / 255;
      const value = srgb(from) + (srgb(to) - srgb(from)) * t;
      const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
      color |= Math.round(encoded * 255) << shift;
    }
    this.state.color = '#' + color.toString(16).padStart(6, '0');
  }
  private sampleWeights(a: Active, op: Op, t: number) {
    if (op.property === 'shape') {
      this.formation.sample(op, op.value as string | Sculpture, t, a.weights.get(op)!, a.ir.seed, this.clock.now());
      const target = capability.shapes.indexOf(String(op.value));
      this.state.shapeWeights = a.weights.get(op)!.map((w, i) => w + ((i === target ? 1 : 0) - w) * t);
      this.state.shape = typeof op.value === 'string' ? op.value : 'assembled';
    }
    if (op.property === 'flow') {
      const target = capability.fields.indexOf(String(op.value));
      this.state.flowWeights = a.flowWeights.get(op)!.map((w, i) => w + ((i === target ? 1 : 0) - w) * t);
      this.state.flow = op.value;
      this.state.flowStrength = a.strengths.get(op)! + (op.strength! - a.strengths.get(op)!) * t;
    }
  }
  private sampleOp(a: Active, op: Op, elapsed: number, writing: Set<Property>) {
    if (elapsed < op.at || a.completed.has(op)) return;
    if (!a.origins.has(op)) {
      a.origins.set(op, this.state[op.property]);
      a.strengths.set(op, this.state.flowStrength);
      a.weights.set(op, [...this.state.shapeWeights]);
      a.flowWeights.set(op, [...this.state.flowWeights]);
      this.blends.delete(op.property);
    }
    let t = ease(op.duration === 0 ? 1 : Math.min(1, (elapsed - op.at) / op.duration), op.easing);
    if (op.effort?.time !== undefined) t = Math.pow(t, Math.pow(2, (0.5 - op.effort.time) * 2));
    if (op.effort?.weight && !['rise', 'advance', 'spread', 'grow'].includes(op.property))
      t = Math.max(0, Math.min(1, t + Math.sin(Math.PI * t) * op.effort.weight * 0.4));
    this.state[op.property] = mix(a.origins.get(op)!, op.value, t);
    if (op.arcAmplitude !== undefined)
      this.state[op.property] = Number(a.origins.get(op)!) * (1 - t) + Math.sin(Math.PI * t) * op.arcAmplitude;
    this.effortPosition(a, op, t);
    this.sampleWeights(a, op, t);
    if (op.property === 'color') this.sampleColor(a, op, t);
    if (elapsed < op.at + op.duration) writing.add(op.property);
    else {
      a.completed.add(op);
      if (op.property in this.baseline && !this.owned.has(op.property))
        this.blend(op.property, this.baseline[op.property as keyof typeof this.baseline], 250, 'smoothstep');
    }
  }
  private nextProgram(now: number) {
    while (this.queue.length) {
      const next = this.queue.shift()!;
      if (now - next.receivedAt > next.ttlMs) {
        this.diagnostics.count('expired');
        this.feedback?.('cancelled', next);
      } else { this.start(next, now); break; }
    }
  }
  private advance(now: number) {
    for (let attempts = 0; attempts < 9; attempts++) {
      const a = this.active;
      if (!a) break;
      if (a.ir.epoch !== this.epoch) { this.active = undefined; break; }
      const elapsed = now - a.start, writing = new Set<Property>();
      if (!a.applied) { a.applied = true; this.feedback?.('applied', a.ir); }
      for (const op of a.ir.ops) this.sampleOp(a, op, elapsed, writing);
      for (const p of this.owned)
        if (!writing.has(p) && p in this.baseline)
          this.blend(p, this.baseline[p as keyof typeof this.baseline], 250, 'smoothstep');
      this.owned = writing;
      if (elapsed < a.ir.duration) break;
      this.release();
      this.feedback?.('completed', a.ir);
      this.active = undefined;
      this.nextProgram(now);
    }
  }
  private sampleBaseline(now: number) {
    for (const [p, b] of this.blends) {
      const t = ease(b.duration === 0 ? 1 : Math.min(1, (now - b.start) / b.duration), b.easing);
      this.state[p] = b.from + (b.to - b.from) * t;
      if (t >= 1) this.blends.delete(p);
    }
    this.stateFeedback = this.stateFeedback.filter(f => {
      const properties = Object.entries(f.ir.patch);
      if (!f.applied && properties.some(([p]) => !this.owned.has(p as Property))) {
        f.applied = true;
        this.feedback?.('applied', f.ir);
      }
      if (properties.every(([p, value]) => !this.owned.has(p as Property) &&
          !this.blends.has(p as Property) && Math.abs(Number(this.state[p as Property]) - value!) < 1e-8)) {
        this.feedback?.('completed', f.ir);
        return false;
      }
      return true;
    });
  }
  tick() {
    const now = this.clock.now();
    this.advance(now);
    this.sampleBaseline(now);
    const requested = this.state.presenceIntent ?? { activity: 'idle' };
    const renderer = this.sink as RendererSink & { reducedMotion?: boolean };
    const intent = renderer.reducedMotion && requested.mode !== 'off'
      ? { ...requested, mode: 'reduced' as const } : requested;
    this.state.presencePose = this.presence.sample(now, intent,
      ['shape', 'rise', 'advance', 'grow', 'spread', 'arcOffset'].some(p => this.owned.has(p as Property)));
    this.formation.motionMode = intent.mode ?? 'normal';
    this.formation.quiet = !!this.state.presenceIntent && ['idle', 'done', 'unknown'].includes(intent.activity);
    this.formation.tick(now);
    this.state.particlePositions = this.formation.perform(this.state.presencePose.parts);
    this.state.particleGroups = this.formation.points ? this.formation.groups : undefined;
    this.state.particleParts = this.formation.parts;
    this.state.ownedProperties = [...this.owned];
    const dt = this.renderAt === undefined ? 0 : Math.max(0, Math.min(100, now - this.renderAt));
    this.renderAt = now;
    if (intent.mode !== 'off') this.renderTime += dt;
    this.sink.apply({ ...this.state, shapeWeights: [...this.state.shapeWeights] }, this.renderTime);
  }
  dispose() {
    this.active = undefined;
    this.queue = [];
    this.sink.dispose();
  }
}
