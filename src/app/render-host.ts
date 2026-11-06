import type { Compiled } from '../core/runtime/ir';
import { Scheduler } from '../core/runtime/scheduler';
import { ThreeRenderer } from '../adapters/three-renderer';
export class RenderHost {
  private worker?: Worker;
  private scheduler?: Scheduler;
  private renderer?: ThreeRenderer;
  private pending = new Map<
    number,
    { resolve: (status: string) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private next = 0;
  private raf = 0;
  private epoch = 'idle';
  private ready = false;
  private stopped = false;
  private fallbackStarted = false;
  private timeout?: ReturnType<typeof setTimeout>;
  private resize: ResizeObserver;
  mode = 'starting';
  particles = 10000;
  private reduced = false;
  constructor(
    private canvas: HTMLCanvasElement,
    private error: (code: string) => void,
    private stats: (value: { frameP95: number; queue: number; particles: number }) => void,
    private feedback?: (event: { epoch: string; seq: number; status: string }) => void,
    private seed = 42,
  ) {
    this.resize = new ResizeObserver(() => this.size());
    this.resize.observe(canvas);
    this.start();
    document.addEventListener('visibilitychange', this.visibility);
  }
  private async start() {
    // Probe actual Worker + OffscreenCanvas WebGL support before transferring the visible canvas.
    if (typeof OffscreenCanvas !== 'undefined' && this.canvas.transferControlToOffscreen) {
      try {
        const probe = new Worker(new URL('../workers/probe.worker.ts', import.meta.url), {
          type: 'module',
        });
        const ok = await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => resolve(false), 1500);
          probe.onmessage = (e) => {
            clearTimeout(timeout);
            resolve(e.data === true);
          };
          probe.onerror = () => resolve(false);
        });
        probe.terminate();
        if (ok && !this.stopped) {
          this.worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url), {
            type: 'module',
          });
          const owner = this.worker;
          this.worker.onmessage = (e) => {
            if (this.worker === owner) this.message(e.data);
          };
          this.worker.onerror = (event) => {
            event.preventDefault();
            if (this.worker === owner) this.fallback('render_worker_crash');
          };
          const box = this.canvas.getBoundingClientRect(),
            offscreen = this.canvas.transferControlToOffscreen();
          this.worker.postMessage(
            {
              type: 'init',
              seed: this.seed,
              canvas: offscreen,
              width: box.width,
              height: box.height,
              dpr: devicePixelRatio,
              epoch: this.epoch,
            },
            [offscreen],
          );
          this.timeout = setTimeout(() => {
            if (!this.ready) this.fallback('render_init_timeout');
          }, 2000);
          return;
        }
      } catch {
        this.error('offscreen_unavailable');
      }
    }
    if (!this.stopped) this.fallback();
  }
  private message(m: { type: string; data: any }) {
    if (m.type === 'ready') {
      this.ready = true;
      this.mode = 'offscreen worker';
      clearTimeout(this.timeout);
      this.setMotion(this.reduced);
    }
    if (m.type === 'ack') {
      const p = this.pending.get(m.data.id);
      if (p) {
        clearTimeout(p.timer);
        p.resolve(m.data.status);
        this.pending.delete(m.data.id);
      }
    }
    if (m.type === 'feedback') this.feedback?.(m.data);
    if (m.type === 'stats') this.stats(m.data);
    if (m.type === 'error') this.error(m.data);
    if (m.type === 'init_failed') this.fallback('render_init_failed');
  }
  private fallback(reason?: string) {
    if (this.stopped || this.fallbackStarted) return;
    this.fallbackStarted = true;
    if (reason) this.error(reason);
    this.worker?.terminate();
    this.worker = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve('pending');
    }
    this.pending.clear();
    clearTimeout(this.timeout);
    if (this.ready || reason) {
      const replacement = this.canvas.cloneNode() as HTMLCanvasElement;
      this.resize.unobserve(this.canvas);
      this.canvas.replaceWith(replacement);
      this.canvas = replacement;
      this.resize.observe(this.canvas);
    }
    this.mode = 'main thread fallback';
    this.ready = false;
    try {
      this.renderer = new ThreeRenderer(this.canvas, this.error, this.seed);
      this.renderer.quality(5000);
      this.particles = 5000;
      this.renderer.reducedMotion = this.reduced;
      this.scheduler = new Scheduler(
        { now: () => performance.now() },
        this.renderer,
        { count: this.error },
        (status, ir) => this.feedback?.({ status, epoch: ir.epoch, seq: ir.seq }),
      );
      this.scheduler.cancel(this.epoch);
      this.size();
      let previous = performance.now(),
        samples: number[] = [];
      const frame = () => {
        if (this.stopped) return;
        const now = performance.now();
        if (!document.hidden) {
          samples.push(now - previous);
          if (samples.length > 120) samples.shift();
          this.scheduler?.tick();
          if (samples.length % 30 === 0)
            this.stats({
              frameP95: [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)] ?? 0,
              queue: this.scheduler?.queueDepth ?? 0,
              particles: this.particles,
            });
        }
        previous = now;
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    } catch {
      this.mode = 'unavailable';
      this.error('webgl_unavailable');
    }
  }
  private visibility = () => {
    this.worker?.postMessage({ type: 'visible', visible: !document.hidden });
  };
  private size() {
    const b = this.canvas.getBoundingClientRect();
    this.worker?.postMessage({
      type: 'resize',
      width: b.width,
      height: b.height,
      dpr: devicePixelRatio,
    });
    this.renderer?.resize(b.width, b.height, devicePixelRatio);
  }
  setEpoch(epoch: string) {
    this.epoch = epoch;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve('cancelled');
    }
    this.pending.clear();
    this.worker?.postMessage({ type: 'epoch', epoch });
    this.scheduler?.cancel(epoch);
  }
  apply(ir: Compiled, deadlineAt?: number): Promise<string> {
    if (this.worker) {
      if (!this.ready) {
        this.error('renderer_starting');
        return Promise.resolve('renderer_starting');
      }
      if (this.pending.size >= 4) {
        this.error('render_mailbox_full');
        return Promise.resolve('render_mailbox_full');
      }
      const id = ++this.next;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.error('render_ack_delayed');
        }, 500);
        this.pending.set(id, { resolve, timer });
        this.worker!.postMessage({
          type: 'ir',
          ir: { ...ir, ...(deadlineAt === undefined ? {} : { deadlineAt }) },
          clockOrigin: performance.timeOrigin,
          id,
        });
      });
    } else
      return Promise.resolve(
        this.scheduler?.admit({ ...ir, ...(deadlineAt === undefined ? {} : { deadlineAt }) }) ??
          'renderer_unavailable',
      );
  }
  setMotion(reduced: boolean) {
    this.reduced = reduced;
    this.worker?.postMessage({ type: 'motion', reduced });
    if (this.renderer) this.renderer.reducedMotion = reduced;
  }
  setQuality(count: number) {
    this.particles = count;
    this.worker?.postMessage({ type: 'quality', count });
    this.renderer?.quality(count);
  }
  dispose() {
    this.stopped = true;
    clearTimeout(this.timeout);
    cancelAnimationFrame(this.raf);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve('cancelled');
    }
    this.pending.clear();
    this.worker?.postMessage({ type: 'dispose' });
    this.worker?.terminate();
    this.scheduler?.dispose();
    this.resize.disconnect();
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
