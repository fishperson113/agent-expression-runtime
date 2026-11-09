import { expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { openCodexTransport } from '../integrations/live-codex-transport.mjs';
const cleanup = vi.hoisted(() => ({ gate: null, fail: false }));
vi.mock('../scripts/start-session.mjs', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, stopChild: async child => { if (cleanup.gate) await cleanup.gate;
    await actual.stopChild(child); if (cleanup.fail) throw Error('synthetic_private_cleanup_error'); } };
});

it('reports an unexpected app-server exit before closing its Native relay', async () => {
  let failures = 0;
  const transport = await openCodexTransport({ host: { command: process.execPath, args: ['-e', 'setTimeout(()=>process.exit(7),100)', '--'] },
    args: [], cwd: process.cwd(), env: process.env, instructions: '', onFailure: () => { failures++; } });
  const socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } });
  try { await once(socket, 'open'); await once(socket, 'close'); expect(failures).toBe(1); }
  finally { socket.terminate(); await transport.close(); }
});
it('shares deferred first cleanup and retains its failure for overlapping callers', async () => {
  const transport = await openCodexTransport({ host: { command: process.execPath, args: ['-e', 'process.stdin.resume()', '--'] },
    args: [], cwd: process.cwd(), env: process.env, instructions: '' });
  const socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } });
  let release, first, second;
  try {
    await once(socket, 'open'); cleanup.fail = true; cleanup.gate = new Promise(resolve => { release = resolve; });
    first = transport.close(); second = transport.close();
    void first.catch(() => {}); void second.catch(() => {});
    expect(await Promise.race([second.then(() => 'early'), new Promise(resolve => setImmediate(() => resolve('pending')))])).toBe('pending');
    release(); await expect(first).rejects.toThrow('live_cleanup_failed'); await expect(second).rejects.toThrow('live_cleanup_failed');
  } finally { release?.(); await Promise.allSettled([first, second]); cleanup.gate = null; cleanup.fail = false; socket.terminate(); await transport.close().catch(() => {}); }
});
it('does not report owned transport cleanup as a failure', async () => {
  let failures = 0;
  const transport = await openCodexTransport({ host: { command: process.execPath, args: ['-e', 'process.stdin.resume()', '--'] },
    args: [], cwd: process.cwd(), env: process.env, instructions: '', onFailure: () => { failures++; } });
  const socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } });
  try { await once(socket, 'open'); await transport.close(); expect(failures).toBe(0); }
  finally { socket.terminate(); await transport.close(); }
});
