import { expect, it, vi } from 'vitest';
import { RenderHost } from '../src/app/render-host';

it('cancels uncertain admissions when a dead renderer is replaced', async () => {
  const host = Object.create(RenderHost.prototype) as any;
  const worker = { terminate: vi.fn() }, startMainRenderer = vi.fn();
  Object.assign(host, { worker, pending: new Map(), ready: false, reduced: false,
    stopped: false, fallbackStarted: false, error: vi.fn(), startMainRenderer });
  let resolve!: (status: string) => void;
  const result = new Promise<string>(accept => { resolve = accept; });
  host.pending.set(1, { resolve, timer: setTimeout(() => {}, 10000) });
  host.fallback();
  expect(await result).toBe('cancelled');
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(host.pending.size).toBe(0);
  expect(startMainRenderer).toHaveBeenCalledOnce();
});
it('starts recovery when the renderer never acknowledges an admission', async () => {
  vi.useFakeTimers();
  try {
    const host = Object.create(RenderHost.prototype) as any;
    const fallback = vi.fn();
    Object.assign(host, { worker: { postMessage: vi.fn() }, ready: true, pending: new Map(), next: 0, fallback });
    const result = host.apply({ kind: 'define', epoch: 'e', seq: 1, receivedAt: 0, ttlMs: 2000 });
    vi.advanceTimersByTime(1500);
    expect(fallback).toHaveBeenCalledWith('render_ack_timeout');
    host.pending.get(1).resolve('cancelled');
    expect(await result).toBe('cancelled');
  } finally { vi.useRealTimers(); }
});
