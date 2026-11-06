import type { Compiled } from '../core/runtime/ir';
export class CompilerHost {
  private worker!: Worker;
  private pending = new Map<number, { epoch: string; at: number; context?: string; timer: ReturnType<typeof setTimeout> }>();
  private next = 0;
  private epoch = 'idle';
  private restarts = 0;
  private available = false;
  constructor(
    private result: (ir: Compiled, context?: string) => void,
    private error: (code: string, context?: string, path?: string) => void,
    private seed = 42,
  ) {
    this.spawn();
  }
  private spawn() {
    try {
      this.worker = new Worker(new URL('../workers/compiler.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      this.available = false;
      this.error('compiler_unavailable');
      return;
    }
    this.available = true;
    this.worker.postMessage({ type: 'seed', seed: this.seed });
    this.worker.postMessage({ type: 'epoch', epoch: this.epoch });
    const owner = this.worker;
    this.worker.onmessage = (e) => {
      if (owner !== this.worker || !this.available) return;
      const job = this.pending.get(e.data.id);
      if (!job) return;
      clearTimeout(job.timer);
      this.pending.delete(e.data.id);
      if (e.data.error) this.error(e.data.error.code, job.context, e.data.error.path);
      else this.result(e.data.ir, job.context);
    };
    this.worker.onerror = (event) => {
      event?.preventDefault();
      if (owner !== this.worker || !this.available) return;
      this.restart('compiler_crash');
    };
  }
  private clearPending(code?: string) {
    const jobs = [...this.pending.values()];
    this.pending.clear();
    for (const job of jobs) {
      clearTimeout(job.timer);
      if (code) this.error(code, job.context);
    }
  }
  private restart(reason: string) {
    if (!this.available) return;
    this.available = false;
    this.worker.terminate();
    this.clearPending(reason);
    if (this.restarts++ < 1) { this.error('compiler_restarted'); this.spawn(); }
    else this.error('compiler_unavailable');
  }
  submit(record: unknown, receivedAt: number, context?: string) {
    if (!this.available) {
      this.error('compiler_unavailable', context);
      return false;
    }
    if (this.pending.size >= 4) {
      this.error('compiler_full', context);
      return false;
    }
    const id = ++this.next;
    const timer = setTimeout(() => this.restart('compiler_timeout'), 1500);
    this.pending.set(id, { epoch: this.epoch, at: receivedAt, context, timer });
    this.worker.postMessage({ id, epoch: this.epoch, record, receivedAt });
    return true;
  }
  setEpoch(epoch: string) {
    this.epoch = epoch;
    this.clearPending('stale_epoch');
    if (this.available) this.worker.postMessage({ type: 'epoch', epoch });
  }
  resetSession() {
    this.clearPending('session_closed');
    if (this.available) this.worker.postMessage({ type: 'reset' });
  }
  settleDefinition(ir: Compiled, accepted: boolean) {
    if (ir.kind === 'define' && ir.draft !== undefined && this.available)
      this.worker.postMessage({ type: 'settle', epoch: ir.epoch, draft: ir.draft, accepted });
  }
  get depth() {
    return this.pending.size;
  }
  dispose() {
    this.available = false;
    this.clearPending();
    this.worker?.terminate();
  }
}
