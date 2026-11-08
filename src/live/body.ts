import { ThreeRenderer } from '../adapters/three-renderer';
import { Scheduler } from '../core/runtime/scheduler';
import { LiveCompiler, referencedParts } from '../core/live/compiler';
import { LiveCompositor } from '../core/live/compositor';
import { transformMatrices } from '../core/live/transforms';
import { validateConfiguration } from '../core/live/control-validation';
import defaults from '../../integrations/live-reflexes.json';
import type { BodyState } from '../core/ports';
import type { PresenceState } from '../core/runtime/presence';
import type { Observation, LiveEventKind } from '../core/live/types';
import { faceProgram, faceWrites, isFace } from '../core/live/face';
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
  output = 0;
  feedback?: (event: { epoch: string; seq: number; status: string }) => void;
  constructor(private canvas: HTMLCanvasElement, private status: (text: string) => void) {
    this.renderer = new ThreeRenderer(canvas, status); this.renderer.quality(2000);
    this.scheduler = new Scheduler({ now: () => performance.now() }, { apply: (state, now) => this.apply(state, now),
      dispose: () => this.renderer.dispose() }, { count: status }, (status, ir) => {
        this.trace.record(ir.seq, status, performance.now()); this.feedback?.({ status, epoch: ir.epoch, seq: ir.seq });
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
    if (!document.hidden && this.controls.mode !== 'off') this.scheduler.tick();
    this.frameId = requestAnimationFrame(this.frame);
  };
  private apply(state: BodyState, now: number) {
    const time = performance.now(), parts = state.particleParts ?? [], ids = parts.map(part => part.id).join('|');
    if (ids !== this.partIds) { this.partIds = ids; this.controls.topology(parts.map(part => part.id)); }
    if (time - this.defaultAt > 240000) { this.defaults.install(validateConfiguration(defaults), time); this.defaultAt = time; }
    const snapshot = this.observation && Date.now() - this.observation.capturedAt <= 1500 ? this.observation : null;
    const blocked = this.blocked(state), writes = new Map(this.defaults.sample(time, snapshot, this.output, blocked).map(write => [write.target.part + ':' + write.target.prop, write]));
    if (isFace(parts)) for (const write of faceWrites(this.faceActivity(time), this.output, this.controls.mode)) {
      const key = write.target.part + ':' + write.target.prop, from = this.faceBlend.get(key) ?? (write.target.prop.startsWith('scale') ? 1 : 0);
      const value = from + (write.value - from) * 0.18; this.faceBlend.set(key, value);
      writes.set(key, { ...write, value });
    }
    for (const write of this.controls.sample(time, snapshot, this.output, blocked)) writes.set(write.target.part + ':' + write.target.prop, write);
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
    const at = performance.now();
    this.trace.record(record?.seq, 'received', at);
    try {
      const compiled = record.kind === 'define' ? { program: this.compiler.compiler.prepareDefinition(record, at) } : this.compiler.compile(record, at);
      if (compiled.configuration) {
        const shapes = compiled.program.kind === 'program' ? compiled.program.ops.filter(op => op.property === 'shape') : [];
        const last = shapes.at(-1)?.value;
        const ids = new Set(last === undefined ? this.scheduler.state.particleParts?.map(part => part.id) : typeof last === 'object' ? last.parts.map(part => part.id) : []);
        for (const part of referencedParts(compiled.configuration)) if (!ids.has(part)) throw Error('live_missing_part_' + part);
      }
      const result = this.scheduler.admit(compiled.program), accepted = ['accepted', 'state', 'defined'].includes(result);
      if (compiled.program.kind === 'define' && compiled.program.draft !== undefined) this.compiler.compiler.settleDefinition(compiled.program.draft, accepted);
      if (accepted && compiled.configuration) this.controls.install(compiled.configuration, at);
      this.trace.record(record.seq, accepted ? 'admitted' : 'rejected', performance.now(), accepted ? undefined : result);
      this.status(accepted ? 'Biểu đạt đã được nhận.' : result);
      return { status: accepted ? 'accepted' : 'rejected', code: accepted ? undefined : result, latencyMs: performance.now() - at };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'live_compile_failed';
      this.trace.record(record?.seq, 'rejected', performance.now(), code);
      return { status: 'rejected', code };
    }
  }
  epoch(epoch: string, reset = false) {
    this.trace.reset();
    this.controls.reset(); this.scheduler.cancel(epoch);
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
    this.controls.mode = mode; this.defaults.mode = mode; this.renderer.reducedMotion = mode === 'reduced';
    this.scheduler.state.presenceIntent = { activity: 'idle', mode };
  }
  get metrics() { const sorted = [...this.samples].sort((a, b) => a - b); const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return { activity: this.faceActivity(performance.now()), diagnostics: this.trace.snapshot(), render: this.renderer.renderSnapshot,
      scene: isFace(this.scheduler.state.particleParts ?? []) ? 'face' : this.scheduler.state.shape,
      parts: this.scheduler.state.particleParts?.map(part => part.id) ?? [],
      frameP95: p95, meanFps: 1000 / (this.samples.reduce((sum, value) => sum + value, 0) / Math.max(1, this.samples.length)), particles: this.renderer.count }; }
  dispose() { cancelAnimationFrame(this.frameId); this.resize.disconnect(); this.scheduler.dispose(); }
}
