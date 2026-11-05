import type { Compiled } from '../core/runtime/ir';
export class CompilerHost {
  private worker!: Worker;
  private pending = new Map<number, { epoch: string; at: number; context?: string }>();
  private next = 0;
  private epoch = 'idle';
  private restarts = 0;
  constructor(
    private result: (ir: Compiled, context?: string) => void,
    private error: (code: string, context?: string) => void,
  ) {
    this.spawn();
  }
  private spawn() {
    this.worker = new Worker(new URL('../workers/compiler.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.postMessage({ type: 'epoch', epoch: this.epoch });
    this.worker.onmessage = (e) => {
      const job = this.pending.get(e.data.id);
      if (!job) return;
      this.pending.delete(e.data.id);
      if (e.data.error) this.error(e.data.error.code, job.context);
      else this.result(e.data.ir, job.context);
    };
    this.worker.onerror = () => {
      for (const job of this.pending.values()) this.error('compiler_crash', job.context);
      this.pending.clear();
      this.worker.terminate();
      if (this.restarts++ < 1) this.spawn();
    };
  }
  submit(record: unknown, receivedAt: number, context?: string) {
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
    this.worker.postMessage({ type: 'epoch', epoch });
  }
  get depth() {
    return this.pending.size;
  }
  dispose() {
    this.pending.clear();
    this.worker.terminate();
  }
}
