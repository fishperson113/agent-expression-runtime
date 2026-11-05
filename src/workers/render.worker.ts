import { Scheduler } from '../core/runtime/scheduler';
import { ThreeRenderer } from '../adapters/three-renderer';
let scheduler: Scheduler | undefined,
  renderer: ThreeRenderer | undefined,
  timer: ReturnType<typeof setTimeout> | undefined,
  visible = true;
const send = (type: string, data: unknown) => self.postMessage({ type, data });
const clock = { now: () => performance.now() };
let previous = clock.now(),
  samples: number[] = [];
function frame() {
  if (visible && scheduler) {
    const now = clock.now();
    samples.push(now - previous);
    if (samples.length > 120) samples.shift();
    previous = now;
    scheduler.tick();
    if (samples.length % 30 === 0)
      send('stats', {
        frameP95: [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)] ?? 0,
        queue: scheduler.queueDepth,
        particles: renderer?.count,
      });
  }
  timer = setTimeout(frame, 16);
}
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      renderer = new ThreeRenderer(m.canvas, (c) => send('error', c));
      renderer.resize(m.width, m.height, m.dpr);
      scheduler = new Scheduler(clock, renderer, { count: (c) => send('error', c) }, (status, ir) =>
        send('feedback', { status, epoch: ir.epoch, seq: ir.seq }),
      );
      scheduler.cancel(m.epoch);
      send('ready', true);
      frame();
    }
    if (m.type === 'epoch') scheduler?.cancel(m.epoch);
    if (m.type === 'ir') {
      const status =
        scheduler?.admit({
          ...m.ir,
          receivedAt: clock.now() - m.age,
          ...(m.deadlineRemaining !== undefined
            ? { deadlineAt: clock.now() + m.deadlineRemaining }
            : {}),
        }) ?? 'renderer_unavailable';
      send('ack', { id: m.id, status });
    }
    if (m.type === 'resize') renderer?.resize(m.width, m.height, m.dpr);
    if (m.type === 'quality') renderer?.quality(m.count);
    if (m.type === 'motion' && renderer) renderer.reducedMotion = m.reduced;
    if (m.type === 'visible') {
      visible = m.visible;
      previous = clock.now();
    }
    if (m.type === 'dispose') {
      clearTimeout(timer);
      scheduler?.dispose();
      self.close();
    }
  } catch {
    send('error', 'render_failure');
    if (m.type === 'init') send('init_failed', true);
  }
};
