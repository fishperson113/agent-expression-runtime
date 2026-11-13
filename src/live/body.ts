import { capability } from '../primitives/registry';
import { presentationDuration } from '../core/live/presentation-duration';
import { ThreeRenderer } from '../adapters/three-renderer';
import { Scheduler } from '../core/runtime/scheduler';
import { ExpressionLifecycle } from '../core/live/expression-lifecycle';
import { VisualAttention } from '../core/live/visual-attention';
import { LiveCompiler, referencedParts } from '../core/live/compiler';
import { LiveCompositor, composeWrites, type TransformWrite } from '../core/live/compositor';
import { transformMatrices } from '../core/live/transforms';
import { validateObservation } from '../core/live/observation';
import { validateConfiguration } from '../core/live/control-validation';
import defaults from '../../integrations/live-reflexes.json';
import type { BodyState } from '../core/ports';
import type { PresenceState } from '../core/runtime/presence';
import type { Observation, LiveEventKind } from '../core/live/types';
import { faceProgram, faceWrites, geometricGazeWrites, hasCanonicalFaceComponent, isFace } from '../core/live/face';
import type { LiveCompiled } from '../core/live/control-types';
import type { ReactiveOwnership } from '../core/live/decision-types';
import type { ReactiveLease, LeaseRevokeReason } from '../core/live/reactive-lease';
import type { ReactiveSession } from '../core/live/reactive-session';
import { SceneTrace, type TraceAttribution } from '../core/live/trace';
import type { Compiled } from '../core/runtime/ir';

export class LiveBody {
  readonly renderer: ThreeRenderer;
  readonly scheduler: Scheduler;
  readonly controls = new LiveCompositor();
  readonly trace = new SceneTrace();
  private defaults = new LiveCompositor({ releaseUnavailableBindings: true });
  private compiler = new LiveCompiler();
  private observation: Observation | null = null;
  private attention = new VisualAttention({ now: () => performance.now(), wallNow: () => Date.now() });
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
  private userGeometryLocked = false;
  private transientScene?: { epoch: string; seq: number };
  private publicContext?: { epoch: string; seq: number; until: number; text: string; mode: 'open' | 'quiet'; expired?: boolean };
  private observerHandoff?: { epoch: string; seq: number; from: number; until: number };
  private origins = new WeakMap<Compiled, TraceAttribution>();
  private lifecycle = new ExpressionLifecycle((status, ir) => {
    const source = this.origins.get(ir) ?? { origin: 'ambient' as const };
    this.trace.record(ir.seq, status, performance.now(), undefined, ir.epoch, source);
    if (source.origin === 'native') this.feedback?.({ status, epoch: ir.epoch, seq: ir.seq });
  });
  private restingParts?: unknown;
  private chatSceneParts?: unknown;
  private chatSceneRevision = 0;
  chatSceneContext() {
    if (document.hidden || this.controls.mode === 'off' || this.scheduler.busy || this.scheduler.queueDepth || this.reactiveOwner) return null;
    const parts = this.scheduler.sceneParts;
    if (!parts || !parts.length || parts.length > capability.assembly.parts) return null;
    if (parts !== this.chatSceneParts) { this.chatSceneParts = parts; this.chatSceneRevision++; }
    return { schemaVersion: 1, epoch: this.scheduler.epoch, revision: this.chatSceneRevision,
      capturedAt: Date.now(), partIds: parts.map(part => part.id), capacity: capability.assembly.parts,
      remaining: capability.assembly.parts - parts.length };
  }
  output = 0;
  feedback?: (event: { epoch: string; seq: number; status: string }) => void;
  constructor(private canvas: HTMLCanvasElement, private status: (text: string) => void) {
    this.renderer = new ThreeRenderer(canvas, status); this.renderer.quality(2000);
    this.scheduler = new Scheduler({ now: () => performance.now() }, { apply: (state, now) => this.apply(state, now),
      dispose: () => this.renderer.dispose() }, { count: status }, (status, ir) => {
        this.lifecycle.feedback(status, ir);
      }, 2000, { brightness: 0.95, pointSize: 2.2, dispersion: 0 });
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
    if (!document.hidden && this.controls.mode !== 'off') {
      this.scheduler.tick(); this.lifecycle.tick(now);
    }
    this.frameId = requestAnimationFrame(this.frame);
  };
  private apply(state: BodyState, now: number) {
    const time = performance.now(), parts = state.particleParts ?? [], ids = parts.map(part => part.id).join('|'), resting = isFace(parts);
    if (ids !== this.partIds) { this.partIds = ids; this.controls.topology(parts.map(part => part.id)); }
    if (time - this.defaultAt > 240000) { this.defaults.install(validateConfiguration(defaults), time); this.defaultAt = time; }
    const snapshot = this.observation && Date.now() - this.observation.capturedAt <= 1500 ? this.observation : null;
    const blocked = this.blocked(state), face: TransformWrite[] = [];
    const smoothing = 1 - Math.exp(-Math.min(100, Math.max(0, time - this.faceAt)) / 84); this.faceAt = time;
    const point = this.attention.sample(this.scheduler.epoch, this.activityState,
      !resting || this.userGeometryLocked || time < this.userLeaseUntil || this.scheduler.busy, this.controls.mode);
    if (resting || hasCanonicalFaceComponent(parts)) for (const write of faceWrites(this.faceActivity(time), this.output, this.controls.mode, time, point?.strength ?? 0)) {
      const key = write.target.part + ':' + write.target.prop, from = this.faceBlend.get(key) ?? (write.target.prop.startsWith('scale') ? 1 : 0);
      const value = from + (write.value - from) * smoothing; this.faceBlend.set(key, value);
      face.push({ ...write, value });
    }
    const local = this.userGeometryLocked ? [] : this.defaults.sample(time, snapshot, this.output, blocked);
    const gaze = geometricGazeWrites(point);
    const layers = [local, face, gaze, this.controls.sample(time, snapshot, this.output, blocked)];
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
    const append = record?.body?.configuration?.sceneAppend === true;
    if (!append) this.prepareUserMutation();
    const at = performance.now();
    this.trace.record(record?.seq, 'received', at, undefined, record?.epoch, { origin: 'native' });
    try {
      if (append && (document.hidden || this.controls.mode === 'off' || this.scheduler.busy || this.scheduler.queueDepth || this.reactiveOwner)) throw Error('scene_append_unavailable');
      if (append && record.epoch !== this.scheduler.epoch) throw Error('stale_epoch');
      const compiled = record.kind === 'define' ? { program: this.compiler.compiler.prepareDefinition(record, at) } : this.compiler.compile(record, at, append ? this.scheduler.sceneParts : undefined);
      const result = this.admitCompiled(compiled, at), accepted = ['accepted', 'state', 'defined'].includes(result);
      if (accepted && append) this.prepareUserMutation();
      if (accepted) { this.userLeaseUntil = Math.max(this.userLeaseUntil, this.leaseUntil(compiled, at)); this.userGeometry(compiled, at);
        if (compiled.configuration?.transient === true && this.userGeometryLocked && compiled.program.kind === 'program')
          this.transientScene = { epoch: this.scheduler.epoch, seq: compiled.program.seq };
        const context = compiled.configuration?.observerContext;
        if (context && compiled.program.kind === 'program') this.publicContext = { epoch: this.scheduler.epoch, seq: compiled.program.seq,
          until: this.userLeaseUntil + context.durationMs, text: context.text, mode: context.mode };
        const ms = compiled.configuration?.observerHandoffMs;
        if (ms !== undefined && this.userGeometryLocked && compiled.program.kind === 'program')
          this.observerHandoff = { epoch: this.scheduler.epoch, seq: compiled.program.seq, from: this.userLeaseUntil, until: this.userLeaseUntil + ms };
      }
      this.trace.record(record.seq, accepted ? 'admitted' : 'rejected', performance.now(), accepted ? undefined : result, record.epoch, { origin: 'native' });
      this.status(accepted ? 'Biểu đạt đã được nhận.' : result);
      return { status: accepted ? 'accepted' : 'rejected', code: accepted ? undefined : result, latencyMs: performance.now() - at };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'live_compile_failed';
      this.trace.record(record?.seq, 'rejected', performance.now(), code, record?.epoch, { origin: 'native' });
      return { status: 'rejected', code };
    }
  }
  attachReactive(session: ReactiveSession) { this.reactive = session; }
  revokeObserverHandoff(preserveScene = false) { this.observerHandoff = undefined; this.publicContext = undefined; if (!preserveScene) this.transientScene = undefined; }
  observerContext() {
    const value = this.publicContext;
    if (value && (value.epoch !== this.scheduler.epoch || performance.now() >= value.until + 120000)) this.publicContext = undefined;
    if (this.publicContext && performance.now() >= this.publicContext.until) this.publicContext.expired = true;
    return this.publicContext && !this.publicContext.expired ? { revision: this.publicContext.seq, text: this.publicContext.text, mode: this.publicContext.mode } : null;
  }
  observerContextRemainingMs() { return this.observerContext() ? Math.max(0, this.publicContext!.until - performance.now()) : 0; }
  recentObserverContext() {
    if (this.observerContext()) return null;
    const value = this.publicContext;
    return value ? { revision: value.seq, text: value.text, previousMode: value.mode, expired: true as const } : null;
  }
  observerContextReadKey(): number | string | null {
    const active = this.observerContext();
    if (active) return active.revision;
    return this.recentObserverContext() ? `expired:${this.publicContext!.seq}:${this.publicContext!.until}` : null;
  }
  matchesObserverContext(revision: number | string | null) { return this.observerContextReadKey() === revision; }
  prepareUserMutation() { this.revokeObserverHandoff(); this.attention.revoke(); this.reactive?.userIntent(); }
  get userSceneOwned() { return this.userGeometryLocked; }
  canConverse() { return this.controls.mode !== 'off' && this.observerContext()?.mode !== 'quiet' && performance.now() >= this.userLeaseUntil && !this.scheduler.busy; }
  canReactive() { return (!this.userGeometryLocked || this.transientScene?.epoch === this.scheduler.epoch || this.handoffAvailable()) && this.canConverse(); }
  private handoffAvailable() {
    const grant = this.observerHandoff, now = performance.now();
    if (grant && (grant.epoch !== this.scheduler.epoch || now >= grant.until)) this.observerHandoff = undefined;
    return !!grant && grant === this.observerHandoff && now >= grant.from;
  }
  private userGeometry(compiled: LiveCompiled, at: number) {
    if (compiled.program.kind !== 'program') return;
    const shape = compiled.program.ops.filter(op => op.property === 'shape').at(-1)?.value;
    if (shape === undefined) return;
    const resting = typeof shape === 'object' && isFace(shape.parts);
    this.userGeometryLocked = !resting;
    if (resting && compiled.configuration && !compiled.configuration.controls.length && !compiled.configuration.poses.length)
      this.userLeaseUntil = at + compiled.program.duration;
  }
  private leaseUntil(compiled: LiveCompiled, at: number) {
    const program = compiled.program, duration = presentationDuration(program);
    const start = program.kind === 'program' && program.policy === 'append' ? Math.max(at, this.userLeaseUntil) : at;
    return Math.max(start + duration, at + (compiled.configuration?.lifetimeMs ?? 0));
  }
  private validateParts(compiled: LiveCompiled) {
    if (compiled.configuration) {
      const shapes = compiled.program.kind === 'program' ? compiled.program.ops.filter(op => op.property === 'shape') : [];
      const last = shapes.at(-1)?.value;
      const ids = new Set(last === undefined ? this.scheduler.state.particleParts?.map(part => part.id) : typeof last === 'object' ? last.parts.map(part => part.id) : []);
      for (const part of referencedParts(compiled.configuration)) if (!ids.has(part)) throw Error('live_missing_part_' + part);
    }
  }
  private admitCompiled(compiled: LiveCompiled, at: number, source: TraceAttribution = { origin: 'native' }) {
    this.validateParts(compiled);
    this.origins.set(compiled.program, source);
    const result = this.scheduler.admit(compiled.program), accepted = ['accepted', 'state', 'defined'].includes(result);
    if (compiled.program.kind === 'define' && compiled.program.draft !== undefined) this.compiler.compiler.settleDefinition(compiled.program.draft, accepted);
    if (accepted && compiled.configuration && !compiled.configuration.sceneAppend) {
      this.lifecycle.cancel();
      const config = compiled.configuration;
      const duration = config.controls.length ? config.lifetimeMs :
        Math.max(0, ...config.poses.map(pose => (pose.delayMs ?? 0) + pose.durationMs));
      if (source.origin === 'native' && compiled.program.kind !== 'define' && duration > 0)
        this.lifecycle.configuration(compiled.program, at + duration);
      this.controls.install(compiled.configuration, at);
    }
    return result;
  }
  admitReactive(compiled: LiveCompiled, owner: ReactiveOwnership) {
    if (compiled.configuration?.sceneAppend !== undefined || compiled.configuration?.observerHandoffMs !== undefined || compiled.configuration?.observerContext !== undefined || compiled.configuration?.transient !== undefined) throw Error('reactive_delegation_forbidden');
    if (!this.canReactive() || compiled.program.kind !== 'program' || compiled.program.epoch !== this.scheduler.epoch) throw Error('reactive_admission_rejected');
    this.validateParts(compiled);
    this.reactiveOwner = owner;
    this.scheduler.cancel(this.scheduler.epoch, false); this.controls.release();
    const source: TraceAttribution = { origin: 'reactive', requestId: owner.requestId, decisionId: owner.decisionId, actionId: owner.actionId };
    const result = this.admitCompiled(compiled, performance.now(), source);
    if (result !== 'accepted') throw Error('reactive_admission_rejected');
    if (this.userGeometryLocked) { this.userGeometryLocked = false; this.observerHandoff = undefined; this.transientScene = undefined; }
    this.trace.record(compiled.program.seq, 'admitted', performance.now(), undefined, compiled.program.epoch, source);
  }
  cancelReactive(owner: ReactiveLease, _reason: LeaseRevokeReason) {
    const current = this.reactiveOwner;
    if (!current || !(['requestId', 'decisionId', 'actionId', 'validUntil'] as const).every(key => current[key] === owner[key])) return;
    this.reactiveOwner = undefined;
    this.scheduler.cancel(this.scheduler.epoch, false); this.controls.release();
    this.restFace(this.controls.mode === 'off' ? 0 : 600);
  }
  epoch(epoch: string, reset = false) {
    const settledRest = this.controls.mode === 'normal' && !this.scheduler.busy && !this.scheduler.queueDepth &&
      !this.reactiveOwner && !this.userGeometryLocked && performance.now() >= this.userLeaseUntil && this.scheduler.sceneParts.length > 0 &&
      this.scheduler.sceneParts === this.restingParts;
    this.revokeObserverHandoff(); this.attention.reset(epoch, this.observation ?? undefined);
    this.reactive?.reset(); this.reactiveOwner = undefined; this.userLeaseUntil = 0; this.userGeometryLocked = false;
    this.trace.reset();
    this.lifecycle.cancel();
    this.controls.reset(); this.scheduler.cancel(epoch, false);
    if (reset) { this.compiler.compiler.reset(); this.partIds = ''; }
    else this.compiler.compiler.discardDefinitions();
    this.restFace(this.controls.mode === 'off' || settledRest ? 0 : 600);
  }
  private restFace(durationMs: number) {
    const record = { v: 1, epoch: this.scheduler.epoch, seq: 0, kind: 'program', track: 'body', policy: 'replace', body: faceProgram(durationMs) };
    const program = this.compiler.compile(record, performance.now()).program;
    this.origins.set(program, { origin: 'ambient' }); const admitted = this.scheduler.admit(program);
    this.faceBlend.clear();
    this.scheduler.tick();
    this.restingParts = admitted === 'accepted' ? this.scheduler.sceneParts : undefined;
  }
  observe(snapshot: Observation) {
    try {
      const next = validateObservation(snapshot), previous = this.observation;
      if (!['tracking', 'absent'].includes(next.camera) || previous && (next.sessionId !== previous.sessionId || next.capturedAt < previous.capturedAt)) this.revokeObserverHandoff(true);
      this.observation = next; this.attention.observe(next);
    }
    catch { this.revokeObserverHandoff(true); this.observation = null; this.attention.unavailable('invalid_observation'); }
  }
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
    if (this.controls.mode === 'off' && mode !== 'off') this.attention.rebase('motion_resume');
    if (mode === 'off') this.attention.revoke('motion_off');
    if (mode === 'off') { this.revokeObserverHandoff(); this.reactive?.reset(); }
    this.controls.mode = mode; this.defaults.mode = mode; this.renderer.reducedMotion = mode === 'reduced';
    this.scheduler.state.presenceIntent = { activity: 'idle', mode };
  }
  get metrics() { const sorted = [...this.samples].sort((a, b) => a - b); const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return { visualAttention: this.attention.snapshot(), reactiveOwner: this.reactiveOwner?.actionId ?? null, userGeometryLocked: this.userGeometryLocked, transientScene: this.transientScene ? { ...this.transientScene } : null, observerHandoff: this.observerHandoff ? { ...this.observerHandoff } : null, userLeaseUntil: this.userLeaseUntil, schedulerBusy: this.scheduler.busy, queueDepth: this.scheduler.queueDepth, activity: this.faceActivity(performance.now()), diagnostics: this.trace.snapshot(), render: this.renderer.renderSnapshot,
      scene: isFace(this.scheduler.state.particleParts ?? []) ? 'face' : this.scheduler.state.shape,
      parts: this.scheduler.state.particleParts?.map(part => part.id) ?? [],
      frameP95: p95, meanFps: 1000 / (this.samples.reduce((sum, value) => sum + value, 0) / Math.max(1, this.samples.length)), particles: this.renderer.count }; }
  dispose() { this.attention.revoke('disposed'); this.lifecycle.cancel(); this.reactive?.configure(false); cancelAnimationFrame(this.frameId); this.resize.disconnect(); this.scheduler.dispose(); }
}
