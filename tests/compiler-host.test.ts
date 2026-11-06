import { afterEach, expect, it, vi } from 'vitest';
import { CompilerHost } from '../src/app/compiler-host';

afterEach(() => vi.unstubAllGlobals());
it('contains worker construction failure without retaining jobs or throwing into the content UI', () => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw Error('worker unavailable');
      }
    },
  );
  const errors: string[] = [];
  const host = new CompilerHost(
    () => {},
    (code) => errors.push(code),
  );
  expect(host.submit({}, 0)).toBe(false);
  expect(host.depth).toBe(0);
  expect(errors).toContain('compiler_unavailable');
  expect(() => host.dispose()).not.toThrow();
});
it('sends an explicit session reset separately from epoch cancellation', () => {
  const messages: unknown[] = [];
  class FakeWorker {
    postMessage(message: unknown) {
      messages.push(message);
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', FakeWorker);
  const host = new CompilerHost(
    () => {},
    () => {},
  );
  host.setEpoch('cancelled');
  expect(messages).not.toContainEqual({ type: 'reset' });
  host.resetSession();
  expect(messages).toContainEqual({ type: 'reset' });
});
it('fails immediately after the restart budget is exhausted without filling a dead mailbox', () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onerror?: () => void;
    onmessage?: (event: unknown) => void;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const errors: string[] = [];
  const host = new CompilerHost(
    () => {},
    (code) => errors.push(code),
  );
  host.submit({}, 0);
  workers[0].onerror!();
  expect(workers).toHaveLength(2);
  workers[0].onerror!();
  expect(workers[1].terminate).not.toHaveBeenCalled();
  host.submit({}, 0);
  workers[1].onerror!();
  for (let i = 0; i < 10; i++) expect(host.submit({}, 0)).toBe(false);
  host.setEpoch('new');
  expect(host.depth).toBe(0);
  expect(errors).toContain('compiler_unavailable');
  expect(errors).not.toContain('compiler_full');
});
it('preserves diagnostic paths and request context from the compiler worker', () => {
  let worker: any;
  vi.stubGlobal('Worker', class {
    onmessage?: (event: unknown) => void;
    constructor() { worker = this; }
    postMessage() {}
    terminate() {}
  });
  const error = vi.fn(), host = new CompilerHost(() => {}, error);
  host.submit({}, 0, 'receipt-1');
  worker.onmessage({ data: { id: 1, error: { code: 'range', path: '$.body.children[1].durationMs' } } });
  expect(error).toHaveBeenCalledWith('range', 'receipt-1', '$.body.children[1].durationMs');
  expect(host.depth).toBe(0);
  host.dispose();
});
