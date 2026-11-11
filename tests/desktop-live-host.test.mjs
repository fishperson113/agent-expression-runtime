import { expect, it, vi } from 'vitest';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { runDesktopHost } from '../integrations/desktop-live-host.mjs';
import { runDesktopMcp } from '../integrations/desktop-mcp-launch.mjs';
function host() {
  const page = Object.assign(new EventEmitter(), { exposeFunction: vi.fn(async () => {}), evaluate: vi.fn(async () => {}) });
  const live = { page, gateway: new EventEmitter(), base: 'http://127.0.0.1:1234', token: 'private-test-token', close: vi.fn(async () => {}) };
  const runtime = { publish: vi.fn(), close: vi.fn() }, open = vi.fn(async () => live);
  return { page, live, runtime, open, claim: vi.fn(() => runtime) };
}
it.each(['close', 'crash', 'gateway', 'abort', 'stop'])('closes the owned Desktop body on %s without launching Native or reopening it', async event => {
  const f = host(), abort = new AbortController(), log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const running = runDesktopHost({ signal: abort.signal, open: f.open, claim: f.claim });
    await vi.waitFor(() => expect(f.runtime.publish).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.page.exposeFunction).toHaveBeenCalledOnce());
    if (event === 'gateway') f.live.gateway.emit('exit'); else if (event === 'abort') abort.abort(); else if (event === 'stop') f.page.exposeFunction.mock.calls[0][1](); else f.page.emit(event);
    expect(await running).toBe(event === 'abort' ? 130 : ['crash', 'gateway'].includes(event) ? 1 : 0);
    expect(f.live.close).toHaveBeenCalledOnce(); expect(f.runtime.close).toHaveBeenCalledOnce(); expect(f.open).toHaveBeenCalledOnce();
    expect(f.page.listenerCount('close')).toBe(0); expect(JSON.stringify(log.mock.calls)).not.toContain(f.live.token);
  } finally { log.mockRestore(); }
});
it('releases its registry claim when startup fails and does nothing if already aborted', async () => {
  const f = host(); f.open.mockRejectedValue(Error('fixture_start_failed'));
  await expect(runDesktopHost({ open: f.open, claim: f.claim })).rejects.toThrow('fixture_start_failed'); expect(f.runtime.close).toHaveBeenCalledOnce();
  const abort = new AbortController(); abort.abort(); expect(await runDesktopHost({ signal: abort.signal, claim: f.claim })).toBe(130); expect(f.claim).toHaveBeenCalledOnce();
});
it.each(['abort', 'eof'])('relays stdio and cleans up on %s without bootstrap or status on stdout', async termination => {
  const input = new PassThrough(), output = new PassThrough(), error = new PassThrough(); let stdout = ''; output.on('data', bytes => { stdout += bytes; });
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const spawn = vi.fn(() => child), stop = vi.fn(async () => { child.emit('close', 0); }), abort = new AbortController();
  const running = runDesktopMcp({ input, output, error, signal: abort.signal, read: () => ({ base: 'http://127.0.0.1:1234', token: 'SECRET' }), spawnChild: spawn, stop });
  const request = '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n', response = '{"jsonrpc":"2.0","id":1,"result":{}}\n';
  const received = once(child.stdin, 'data'); input.write(request); expect((await received)[0].toString()).toBe(request);
  child.stdout.write(response); expect(stdout).toBe(response); expect(stdout).not.toContain('SECRET');
  expect(spawn.mock.calls[0][2]).toMatchObject({ shell: false, env: { AER_PAIRING_TOKEN: 'SECRET', FISCH_MCP_REQUIRE_THREAD: '1', FISCH_LIVE: '1' } });
  if (termination === 'abort') abort.abort(); else input.end();
  expect(await running).toBe(termination === 'abort' ? 130 : 0); expect(stop).toHaveBeenCalledOnce();
});
