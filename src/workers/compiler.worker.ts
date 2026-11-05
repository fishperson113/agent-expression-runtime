import { Compiler } from '../core/compiler/compiler';
const compiler = new Compiler();
let epoch = 'idle';
self.onmessage = (event: MessageEvent) => {
  const job = event.data;
  if (job.type === 'epoch') {
    epoch = job.epoch;
    return;
  }
  if (job.type === 'reset') {
    compiler.reset();
    return;
  }
  if (job.epoch !== epoch) {
    self.postMessage({ id: job.id, error: { code: 'stale_epoch', path: '$' } });
    return;
  }
  try {
    const ir = compiler.compile(job.record, job.receivedAt);
    self.postMessage({ id: job.id, ir });
  } catch (e) {
    const error = e as { code?: string; path?: string };
    self.postMessage({
      id: job.id,
      error: { code: error.code ?? 'compiler_failure', path: error.path ?? '$' },
    });
  }
};
