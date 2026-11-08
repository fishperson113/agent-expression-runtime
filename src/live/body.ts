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

export class LiveBody {
  readonly renderer: ThreeRenderer;
  readonly scheduler: Scheduler;
  readonly controls = new LiveCompositor();
  private defaults = new LiveCompositor();
  private compiler = new LiveCompiler();
  private observation: Observation | null = null;
  private defaultAt = 0;
  private partIds = '';
  private resize: ResizeObserver;
  private frameId = 0;
  private samples: number[] = [];
  private previous = performance.now();
  output = 0;
  feedback?: (event: { epoch: string; seq: number; status: string }) => void;
  constructor(private canvas: HTMLCanvasElement, private status: (text: string) => void) {
    this.renderer = new ThreeRenderer(canvas, status); this.renderer.quality(2000);
    this.scheduler = new Scheduler({ now: () => performance.now() }, { apply: (state, now) => this.apply(state, now),
      dispose: () => this.renderer.dispose() }, { count: status }, (status, ir) => this.feedback?.({ status, epoch: ir.epoch, seq: ir.seq }));
    this.defaults.install(validateConfiguration(defaults), performance.now());
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
    for (const write of this.controls.sample(time, snapshot, this.output, blocked)) writes.set(write.target.part + ':' + write.target.prop, write);
    const rendered = { ...state, liveMatrices: transformMatrices([...writes.values()], parts) } as PresenceState;
    if (rendered.presencePose) {
      rendered.presencePose = { ...rendered.presencePose };
      const ambient = { x: 'x', y: 'y', rotateY: 'yaw', rotateZ: 'roll' } as const;
      for (const [property, key] of Object.entries(ambient)) if (writes.has('body:' + property)) rendered.presencePose[key as 'x' | 'y' | 'yaw' | 'roll'] = 0;
    }
    this.renderer.apply(rendered, now);
  }
  private blocked(state: BodyState) {
    const mapping: Record<string, string[]> = { rise: ['y'], advance: ['z'], grow: ['scaleX', 'scaleY', 'scaleZ'], spread: ['scaleX'], arcOffset: ['x'] };
    return new Set((state.ownedProperties ?? []).flatMap(property => (mapping[property] ?? []).map(prop => 'body:' + prop)));
  }
  admit(record: any) {
    const at = performance.now();
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
      this.status(accepted ? 'Biểu đạt đã được nhận.' : result);
      return { status: accepted ? 'accepted' : 'rejected', code: accepted ? undefined : result, latencyMs: performance.now() - at };
    } catch (error) { return { status: 'rejected', code: error instanceof Error ? error.message : 'live_compile_failed' }; }
  }
  epoch(epoch: string, reset = false) {
    this.controls.reset(); this.scheduler.cancel(epoch);
    if (reset) { this.compiler.compiler.reset(); this.partIds = ''; }
    else this.compiler.compiler.discardDefinitions();
  }
  observe(snapshot: Observation) { this.observation = snapshot; }
  event(type: LiveEventKind) { const now = performance.now(); this.defaults.event(type, now); this.controls.event(type, now); }
  motion(mode: 'normal' | 'reduced' | 'off') {
    this.controls.mode = mode; this.defaults.mode = mode; this.renderer.reducedMotion = mode === 'reduced';
    this.scheduler.state.presenceIntent = { activity: 'idle', mode };
  }
  get metrics() { const sorted = [...this.samples].sort((a, b) => a - b); const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return { frameP95: p95, meanFps: 1000 / (this.samples.reduce((sum, value) => sum + value, 0) / Math.max(1, this.samples.length)), particles: this.renderer.count }; }
  dispose() { cancelAnimationFrame(this.frameId); this.resize.disconnect(); this.scheduler.dispose(); }
}
