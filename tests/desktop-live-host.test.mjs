import { expect, it, vi } from 'vitest';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { runDesktopHost, presentDesktopHost } from '../integrations/desktop-live-host.mjs';
import { runDesktopMcp } from '../integrations/desktop-mcp-launch.mjs';
function host() {
  const page = Object.assign(new EventEmitter(), { waitForFunction: vi.fn(async () => {}), exposeFunction: vi.fn(async () => {}), evaluate: vi.fn(async () => {}) });
  const live = { page, gateway: new EventEmitter(), base: 'http://127.0.0.1:1234', token: 'private-test-token', close: vi.fn(async () => {}) };
  const runtime = { publish: vi.fn(), close: vi.fn() }, open = vi.fn(async () => live);
  const observer = { controlBase: 'http://127.0.0.1:1235', close: vi.fn(async () => {}) };
  return { page, live, runtime, open, observer, startObserver: vi.fn(async () => observer), claim: vi.fn(() => runtime) };
}
it.each(['close', 'crash', 'gateway', 'abort', 'stop', 'pagehide'])('closes the owned Desktop body on %s without launching Native or reopening it', async event => {
  const f = host(), abort = new AbortController(), log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const running = runDesktopHost({ signal: abort.signal, open: f.open, claim: f.claim, startObserver: f.startObserver });
    await vi.waitFor(() => expect(f.runtime.publish).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.page.exposeFunction).toHaveBeenCalledOnce());
    if (event === 'gateway') f.live.gateway.emit('exit'); else if (event === 'abort') abort.abort(); else if (['stop', 'pagehide'].includes(event)) f.page.exposeFunction.mock.calls[0][1](event === 'pagehide' ? 'pagehide' : 'ui'); else f.page.emit(event);
    expect(await running).toBe(event === 'abort' ? 130 : ['crash', 'gateway'].includes(event) ? 1 : 0);
    expect(f.live.close).toHaveBeenCalledOnce(); expect(f.observer.close).toHaveBeenCalledOnce(); expect(f.runtime.close).toHaveBeenCalledOnce(); expect(f.open).toHaveBeenCalledOnce();
    expect(f.page.listenerCount('close')).toBe(0); expect(JSON.stringify(log.mock.calls)).not.toContain(f.live.token);
    expect(JSON.stringify(log.mock.calls)).toContain('[mcp_servers.fisch]');
  } finally { log.mockRestore(); }
});
it('labels Desktop ownership and disables browser submission without inventing a conversation snapshot', () => {
  const controls = [{ disabled: false }, { disabled: false }, { disabled: false }], status = { textContent: '' }, activity = { textContent: '' };
  const form = { hidden: false, querySelectorAll: () => controls }, setAttribute = vi.fn();
  const conversation = { setAttribute, querySelector: name => name === 'form' ? form : status };
  const fischLive = { configureReactive: vi.fn(), logActivity: vi.fn(), externalHostPresentation: vi.fn() };
  const document = { title: '', getElementById: () => activity, querySelector: () => conversation };
  vi.stubGlobal('window', { fischLive }); vi.stubGlobal('document', document);
  try {
    presentDesktopHost();
    expect(form.hidden).toBe(true); expect(controls.every(item => item.disabled)).toBe(true);
    expect(status.textContent).toContain('Codex Desktop đã kết nối Fisch MCP');
    expect(status.textContent).not.toContain('terminal'); expect(setAttribute).toHaveBeenCalledWith('aria-label', 'Biểu đạt từ Codex Desktop qua MCP');
    expect(fischLive.configureReactive).toHaveBeenCalledWith(false); expect(fischLive.externalHostPresentation).toHaveBeenCalledOnce();
    expect(Object.keys(fischLive)).toEqual(['configureReactive', 'logActivity', 'externalHostPresentation']);
  } finally { vi.unstubAllGlobals(); }
});
it('does not install an automatic browser reload or restart handler', async () => {
  const f = host(), log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const running = runDesktopHost({ open: f.open, claim: f.claim, startObserver: f.startObserver });
    await vi.waitFor(() => expect(f.page.evaluate).toHaveBeenCalledOnce());
    expect(f.page.evaluate).toHaveBeenCalledWith(presentDesktopHost);
    expect(f.page.listenerCount('domcontentloaded')).toBe(0);
    f.page.emit('domcontentloaded'); expect(f.page.evaluate).toHaveBeenCalledOnce();
    expect(f.page.waitForFunction).toHaveBeenCalledOnce();
    f.page.emit('close'); expect(await running).toBe(0); expect(f.page.listenerCount('domcontentloaded')).toBe(0);
  } finally { log.mockRestore(); }
});
it('releases its registry claim when startup fails and does nothing if already aborted', async () => {
  const f = host(); f.open.mockRejectedValue(Error('fixture_start_failed'));
  await expect(runDesktopHost({ open: f.open, claim: f.claim, startObserver: f.startObserver })).rejects.toThrow('fixture_start_failed'); expect(f.runtime.close).toHaveBeenCalledOnce();
  const abort = new AbortController(); abort.abort(); expect(await runDesktopHost({ signal: abort.signal, claim: f.claim })).toBe(130); expect(f.claim).toHaveBeenCalledOnce();
});
it('drains an observer startup interrupted by Stop without leaking its resources', async () => {
  const f = host(), pending = Promise.withResolvers(), log = vi.spyOn(console, 'error').mockImplementation(() => {});
  f.startObserver.mockReturnValue(pending.promise);
  try {
    const running = runDesktopHost({ open: f.open, claim: f.claim, startObserver: f.startObserver });
    await vi.waitFor(() => expect(f.startObserver).toHaveBeenCalledOnce());
    f.page.exposeFunction.mock.calls[0][1]('ui'); pending.resolve(f.observer);
    expect(await running).toBe(0); expect(f.observer.close).toHaveBeenCalledOnce(); expect(f.live.close).toHaveBeenCalledOnce();
    expect(f.runtime.publish).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});
it('keeps cleanup bounded when an observer close fails', async () => {
  const f = host(), log = vi.spyOn(console, 'error').mockImplementation(() => {});
  f.observer.close.mockRejectedValue(Error('synthetic_cleanup_failed'));
  try {
    const running = runDesktopHost({ open: f.open, claim: f.claim, startObserver: f.startObserver });
    await vi.waitFor(() => expect(f.runtime.publish).toHaveBeenCalledOnce()); f.page.emit('close');
    expect(await running).toBe(1); expect(f.live.close).toHaveBeenCalledOnce(); expect(f.runtime.close).toHaveBeenCalledOnce();
  } finally { log.mockRestore(); }
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
