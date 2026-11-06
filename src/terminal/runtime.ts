import { PerspectiveCamera, Vector3 } from 'three';
import { randomUUID } from 'node:crypto';
import type { BodyState, RendererSink } from '../core/ports';
import { Compiler } from '../core/compiler/compiler';
import { Scheduler } from '../core/runtime/scheduler';
import { shapeBuffers, fitCamera, frameBody } from '../adapters/three-renderer';
import { sampleBody } from '../adapters/body-geometry';
import { MotionPhase } from '../adapters/motion-phase';
import { capability } from '../primitives/registry';

export class TerminalRenderer implements RendererSink {
  readonly count = 2000;
  private shapes = shapeBuffers(this.count);
  private positions = new Float32Array(this.count * 3);
  private camera = new PerspectiveCamera(42, 1, 0.1, 100);
  private orbit = new MotionPhase();
  private point = new Vector3();
  pixels = Buffer.alloc(0);
  width = 0;
  height = 0;
  resize(width: number, height: number) {
    this.width = Math.max(32, Math.min(512, Math.round(width)));
    this.height = Math.max(32, Math.min(384, Math.round(height)));
    this.pixels = Buffer.alloc(this.width * this.height * 3);
    fitCamera(this.camera, this.width / this.height);
  }
  apply(state: BodyState, now: number) {
    if (!this.width) this.resize(384, 256);
    const angle = this.orbit.advance(now, state.flowStrength * state.flowWeights[capability.fields.indexOf('orbit')]);
    sampleBody(this.shapes, this.positions, this.count, state, now, angle);
    frameBody(this.positions, this.count, this.camera);
    for (let i = 0; i < this.pixels.length; i += 3) this.pixels.set([8, 14, 20], i);
    const color = parseInt(String(state.color).slice(1), 16);
    if (!Number(state.pointSize) || !Number(state.brightness)) return;
    for (let i = 0; i < this.positions.length; i += 3) {
      this.point.fromArray(this.positions, i).project(this.camera);
      const x = Math.round((this.point.x + 1) * 0.5 * (this.width - 1));
      const y = Math.round((1 - this.point.y) * 0.5 * (this.height - 1));
      this.dot(x, y, Math.max(0.75, Number(state.pointSize) / 2), color, Number(state.brightness));
    }
  }
  private dot(x: number, y: number, radius: number, color: number, brightness: number) {
    const reach = Math.ceil(radius);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const distance = (dx * dx + dy * dy) / (radius * radius);
      if (distance > 1 || x + dx < 0 || y + dy < 0 || x + dx >= this.width || y + dy >= this.height) continue;
      const offset = ((y + dy) * this.width + x + dx) * 3, alpha = brightness * (1 - distance);
      for (let channel = 0; channel < 3; channel++) {
        const value = (color >> (16 - channel * 8)) & 255;
        this.pixels[offset + channel] = this.pixels[offset + channel] * (1 - alpha) + value * alpha;
      }
    }
  }
  dispose() { this.pixels = Buffer.alloc(0); }
}

export class TerminalEngine {
  readonly renderer = new TerminalRenderer();
  private compiler = new Compiler();
  private scheduler: Scheduler;
  private epoch = randomUUID();
  private seq = 0;
  constructor(private now = () => performance.now()) {
    this.scheduler = new Scheduler({ now }, this.renderer, { count() {} });
    this.scheduler.cancel(this.epoch);
  }
  express(args: Record<string, unknown>) {
    const allowed = ['body', 'kind', 'policy', 'track', 'ttlMs'];
    if (Object.keys(args).some(key => !allowed.includes(key))) throw Error('unknown_field');
    const kind = args.kind ?? 'program';
    const record = { v: 1, epoch: this.epoch, seq: ++this.seq, ttlMs: args.ttlMs, kind, body: args.body,
      ...(kind === 'program' ? { track: args.track ?? 'body', policy: args.policy ?? 'replace' } : {}) };
    const ir = kind === 'define' ? this.compiler.prepareDefinition(record, this.now()) : this.compiler.compile(record, this.now());
    const result = this.scheduler.admit(ir), accepted = ['accepted', 'state', 'defined'].includes(result);
    if (ir.kind === 'define' && ir.draft !== undefined) this.compiler.settleDefinition(ir.draft, accepted);
    return { status: accepted ? 'accepted' : 'rejected', code: accepted ? undefined : result, seq: this.seq };
  }
  cancel() {
    this.epoch = randomUUID(); this.seq = 0;
    this.compiler.discardDefinitions(); this.scheduler.cancel(this.epoch);
    return { status: 'cancelled' };
  }
  frame(width: number, height: number) {
    if (width !== this.renderer.width || height !== this.renderer.height) this.renderer.resize(width, height);
    this.scheduler.tick();
    return this.renderer.pixels;
  }
  get state() { return this.scheduler.state; }
  dispose() { this.scheduler.dispose(); }
}
