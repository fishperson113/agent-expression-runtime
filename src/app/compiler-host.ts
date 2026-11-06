import type { Compiled } from '../core/runtime/ir';
export class CompilerHost {
  private worker!: Worker;
  private pending = new Map<number, { epoch: string; at: number; context?: string }>();
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
      this.pending.delete(e.data.id);
      if (e.data.error) this.error(e.data.error.code, job.context, e.data.error.path);
      else this.result(e.data.ir, job.context);
    };
    this.worker.onerror = (event) => {
      event?.preventDefault();
      if (owner !== this.worker || !this.available) return;
      for (const job of this.pending.values()) this.error('compiler_crash', job.context);
      this.pending.clear();
      this.worker.terminate();
      this.available = false;
      if (this.restarts++ < 1) {
        this.error('compiler_restarted');
        this.spawn();
      } else this.error('compiler_unavailable');
    };
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
    this.pending.set(id, { epoch: this.epoch, at: receivedAt, context });
    this.worker.postMessage({ id, epoch: this.epoch, record, receivedAt });
    return true;
  }
  setEpoch(epoch: string) {
    this.epoch = epoch;
    for (const job of this.pending.values())
      if (job.context) this.error('stale_epoch', job.context);
    this.pending.clear();
    if (this.available) this.worker.postMessage({ type: 'epoch', epoch });
  }
  resetSession() {
    for (const job of this.pending.values()) this.error('session_closed', job.context);
    this.pending.clear();
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
    this.pending.clear();
    this.worker?.terminate();
  }
}
