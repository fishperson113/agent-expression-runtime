import { ThreeRenderer } from '../adapters/three-renderer';
import { Scheduler } from '../core/runtime/scheduler';
import { LiveCompiler, referencedParts } from '../core/live/compiler';
import { LiveCompositor, composeWrites, type TransformWrite } from '../core/live/compositor';
import { transformMatrices } from '../core/live/transforms';
import { validateConfiguration } from '../core/live/control-validation';
import defaults from '../../integrations/live-reflexes.json';
import type { BodyState } from '../core/ports';
import type { PresenceState } from '../core/runtime/presence';
import type { Observation, LiveEventKind } from '../core/live/types';
import { faceProgram, faceWrites, isFace } from '../core/live/face';
import type { LiveCompiled } from '../core/live/control-types';
import type { ReactiveOwnership } from '../core/live/decision-types';
import type { ReactiveLease, LeaseRevokeReason } from '../core/live/reactive-lease';
import type { ReactiveSession } from '../core/live/reactive-session';
import { SceneTrace } from '../core/live/trace';

export class LiveBody {
  readonly renderer: ThreeRenderer;
  readonly scheduler: Scheduler;
  readonly controls = new LiveCompositor();
  readonly trace = new SceneTrace();
  private defaults = new LiveCompositor();
  private compiler = new LiveCompiler();
  private observation: Observation | null = null;
  private defaultAt = 0;
  private partIds = '';
  private resize: ResizeObserver;
  private frameId = 0;
  private samples: number[] = [];
  private previous = performance.now();
  private activityState = 'idle';
  private attentionUntil = 0;
  private faceBlend = new Map<string, number>();
  private faceAt = performance.now();
  private reactive?: ReactiveSession;
  private reactiveOwner?: ReactiveOwnership;
  private userLeaseUntil = 0;
  output = 0;
  feedback?: (event: { epoch: string; seq: number; status: string }) => void;
  constructor(private canvas: HTMLCanvasElement, private status: (text: string) => void) {
    this.renderer = new ThreeRenderer(canvas, status); this.renderer.quality(2000);
    this.scheduler = new Scheduler({ now: () => performance.now() }, { apply: (state, now) => this.apply(state, now),
      dispose: () => this.renderer.dispose() }, { count: status }, (status, ir) => {
        this.trace.record(ir.seq, status, performance.now(), undefined, ir.epoch); this.feedback?.({ status, epoch: ir.epoch, seq: ir.seq });
      }, 2000);
    this.defaults.install(validateConfiguration(defaults), performance.now());
    this.restFace(0);
    this.resize = new ResizeObserver(() => this.size()); this.resize.observe(canvas); this.size();
    this.frame();
  }
  private size() { const box = this.canvas.getBoundingClientRect(); this.renderer.resize(Math.max(1, box.width), Math.max(1, box.height), devicePixelRatio); }
  private frame = () => {
    const now = performance.now(); this.samples.push(now - this.previous); this.previous = now;
    if (this.samples.length > 120) this.samples.shift();
    this.reactive?.tick();
    if (!document.hidden && this.controls.mode !== 'off') this.scheduler.tick();
    this.frameId = requestAnimationFrame(this.frame);
  };
  private apply(state: BodyState, now: number) {
    const time = performance.now(), parts = state.particleParts ?? [], ids = parts.map(part => part.id).join('|');
    if (ids !== this.partIds) { this.partIds = ids; this.controls.topology(parts.map(part => part.id)); }
    if (time - this.defaultAt > 240000) { this.defaults.install(validateConfiguration(defaults), time); this.defaultAt = time; }
    const snapshot = this.observation && Date.now() - this.observation.capturedAt <= 1500 ? this.observation : null;
    const blocked = this.blocked(state), face: TransformWrite[] = [];
    const smoothing = 1 - Math.exp(-Math.min(100, Math.max(0, time - this.faceAt)) / 84); this.faceAt = time;
    if (isFace(parts)) for (const write of faceWrites(this.faceActivity(time), this.output, this.controls.mode, time)) {
      const key = write.target.part + ':' + write.target.prop, from = this.faceBlend.get(key) ?? (write.target.prop.startsWith('scale') ? 1 : 0);
      const value = from + (write.value - from) * smoothing; this.faceBlend.set(key, value);
      face.push({ ...write, value });
    }
    const layers = [this.defaults.sample(time, snapshot, this.output, blocked), face, this.controls.sample(time, snapshot, this.output, blocked)];
    const writes = new Map(composeWrites(layers).map(write => [write.target.part + ':' + write.target.prop, write]));
    const rendered = { ...state, liveMatrices: transformMatrices([...writes.values()], parts) } as PresenceState;
    if (rendered.presencePose) {
      rendered.presencePose = { ...rendered.presencePose };
      const ambient = { x: 'x', y: 'y', rotateY: 'yaw', rotateZ: 'roll' } as const;
      for (const [property, key] of Object.entries(ambient)) if (writes.has('body:' + property)) rendered.presencePose[key as 'x' | 'y' | 'yaw' | 'roll'] = 0;
    }
    this.renderer.apply(rendered, now);
    const frame = this.renderer.renderSnapshot;
    if (!frame.contextLost) this.trace.frame(frame.frame, frame.signature, time);
  }
  private blocked(state: BodyState) {
    const mapping: Record<string, string[]> = { rise: ['y'], advance: ['z'], grow: ['scaleX', 'scaleY', 'scaleZ'], spread: ['scaleX'], arcOffset: ['x'] };
    return new Set((state.ownedProperties ?? []).flatMap(property => (mapping[property] ?? []).map(prop => 'body:' + prop)));
  }
  admit(record: any) {
    this.reactive?.userIntent();
    const at = performance.now();
    this.trace.record(record?.seq, 'received', at, undefined, record?.epoch);
    try {
      const compiled = record.kind === 'define' ? { program: this.compiler.compiler.prepareDefinition(record, at) } : this.compiler.compile(record, at);
      const result = this.admitCompiled(compiled, at), accepted = ['accepted', 'state', 'defined'].includes(result);
      if (accepted) this.userLeaseUntil = Math.max(this.userLeaseUntil, this.leaseUntil(compiled, at));
      this.trace.record(record.seq, accepted ? 'admitted' : 'rejected', performance.now(), accepted ? undefined : result, record.epoch);
      this.status(accepted ? 'Biểu đạt đã được nhận.' : result);
      return { status: accepted ? 'accepted' : 'rejected', code: accepted ? undefined : result, latencyMs: performance.now() - at };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'live_compile_failed';
      this.trace.record(record?.seq, 'rejected', performance.now(), code, record?.epoch);
      return { status: 'rejected', code };
    }
  }
  attachReactive(session: ReactiveSession) { this.reactive = session; }
  canReactive() { return this.controls.mode !== 'off' && performance.now() >= this.userLeaseUntil && !this.scheduler.busy; }
  private leaseUntil(compiled: LiveCompiled, at: number) {
    const program = compiled.program, duration = program.kind === 'define' ? 0 : program.duration;
    const start = program.kind === 'program' && program.policy === 'append' ? Math.max(at, this.userLeaseUntil) : at;
    return Math.max(start + duration, at + (compiled.configuration?.lifetimeMs ?? 0));
  }
  private admitCompiled(compiled: LiveCompiled, at: number) {
    if (compiled.configuration) {
      const shapes = compiled.program.kind === 'program' ? compiled.program.ops.filter(op => op.property === 'shape') : [];
      const last = shapes.at(-1)?.value;
      const ids = new Set(last === undefined ? this.scheduler.state.particleParts?.map(part => part.id) : typeof last === 'object' ? last.parts.map(part => part.id) : []);
      for (const part of referencedParts(compiled.configuration)) if (!ids.has(part)) throw Error('live_missing_part_' + part);
    }
    const result = this.scheduler.admit(compiled.program), accepted = ['accepted', 'state', 'defined'].includes(result);
    if (compiled.program.kind === 'define' && compiled.program.draft !== undefined) this.compiler.compiler.settleDefinition(compiled.program.draft, accepted);
    if (accepted && compiled.configuration) this.controls.install(compiled.configuration, at);
    return result;
  }
  admitReactive(compiled: LiveCompiled, owner: ReactiveOwnership) {
    if (!this.canReactive() || compiled.program.kind !== 'program' || compiled.program.epoch !== this.scheduler.epoch) throw Error('reactive_admission_rejected');
    this.reactiveOwner = owner;
    this.scheduler.cancel(this.scheduler.epoch, false); this.controls.release();
    const result = this.admitCompiled(compiled, performance.now());
    if (result !== 'accepted') throw Error('reactive_admission_rejected');
    this.trace.record(compiled.program.seq, 'admitted', performance.now(), undefined, compiled.program.epoch);
  }
  cancelReactive(owner: ReactiveLease, _reason: LeaseRevokeReason) {
    const current = this.reactiveOwner;
    if (!current || !(['requestId', 'decisionId', 'actionId', 'validUntil'] as const).every(key => current[key] === owner[key])) return;
    this.reactiveOwner = undefined;
    this.scheduler.cancel(this.scheduler.epoch, false); this.controls.release();
    this.restFace(this.controls.mode === 'off' ? 0 : 600);
  }
  epoch(epoch: string, reset = false) {
    this.reactive?.reset(); this.reactiveOwner = undefined; this.userLeaseUntil = 0;
    this.trace.reset();
    this.controls.reset(); this.scheduler.cancel(epoch, false);
    if (reset) { this.compiler.compiler.reset(); this.partIds = ''; }
    else this.compiler.compiler.discardDefinitions();
    this.restFace(this.controls.mode === 'off' ? 0 : 600);
  }
  private restFace(durationMs: number) {
    const record = { v: 1, epoch: this.scheduler.epoch, seq: 0, kind: 'program', track: 'body', policy: 'replace', body: faceProgram(durationMs) };
    this.scheduler.admit(this.compiler.compile(record, performance.now()).program);
    this.faceBlend.clear();
    this.scheduler.tick();
  }
  observe(snapshot: Observation) { this.observation = snapshot; }
  activity(activity: string) {
    this.trace.activity(activity);
    if (activity === 'working' && this.activityState !== 'working') this.attentionUntil = performance.now() + 250;
    this.activityState = activity;
    this.scheduler.state.presenceIntent = { ...this.scheduler.state.presenceIntent, activity,
      mode: this.controls.mode };
  }
  private faceActivity(at: number) { return this.output > 0.01 ? 'replying' : at < this.attentionUntil ? 'attention' : this.activityState; }
  event(type: LiveEventKind) { const now = performance.now(); this.defaults.event(type, now); this.controls.event(type, now); }
  motion(mode: 'normal' | 'reduced' | 'off') {
    if (mode === 'off') this.reactive?.reset();
    this.controls.mode = mode; this.defaults.mode = mode; this.renderer.reducedMotion = mode === 'reduced';
    this.scheduler.state.presenceIntent = { activity: 'idle', mode };
  }
  get metrics() { const sorted = [...this.samples].sort((a, b) => a - b); const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return { reactiveOwner: this.reactiveOwner?.actionId ?? null, userLeaseUntil: this.userLeaseUntil, schedulerBusy: this.scheduler.busy, queueDepth: this.scheduler.queueDepth, activity: this.faceActivity(performance.now()), diagnostics: this.trace.snapshot(), render: this.renderer.renderSnapshot,
      scene: isFace(this.scheduler.state.particleParts ?? []) ? 'face' : this.scheduler.state.shape,
      parts: this.scheduler.state.particleParts?.map(part => part.id) ?? [],
      frameP95: p95, meanFps: 1000 / (this.samples.reduce((sum, value) => sum + value, 0) / Math.max(1, this.samples.length)), particles: this.renderer.count }; }
  dispose() { this.reactive?.configure(false); cancelAnimationFrame(this.frameId); this.resize.disconnect(); this.scheduler.dispose(); }
}
