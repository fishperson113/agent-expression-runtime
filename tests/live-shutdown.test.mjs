import { expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const state = vi.hoisted(() => ({ pollFailure: false, browserUnavailable: false, closeCalls: 0 }));
vi.mock('../integrations/live-codex-transport.mjs', () => ({ openCodexTransport: async options => {
  state.transport = options; return { url: 'ws://127.0.0.1:1', token: 'synthetic',
    close: () => ++state.closeCalls === 1 ? state.closeResult ?? Promise.resolve() : Promise.resolve(), forward() {}, reject() {}, submitUser() {}, interruptUser() {} };
} }));
vi.mock('../integrations/live-reactive-broker.mjs', () => ({ LiveReactiveBroker: class {
  get browserUnavailable() { return state.browserUnavailable; }
  busy() { return false; }
  close() {} evaluate() { return Promise.resolve(); }
  poll() { return state.pollFailure ? Promise.reject(Error('synthetic_failure')) : Promise.resolve(); }
} }));
vi.mock('../scripts/start-session.mjs', () => ({ stopChild: async child => {
  if (state.noExitCleanupFailure) throw Error('synthetic_private_no_exit_cleanup_error');
  if (child?.exitCode === null && child.signalCode === null) {
    child.signalCode = 'SIGTERM'; queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
  }
  if (state.childCleanupFailure) throw Error('synthetic_private_cleanup_error');
}, codexCommand: async () => ({ command: 'synthetic', args: [] }) }));
vi.mock('../integrations/terminal-ipc.mjs', () => ({ openControl: async () => ({ close: async () => { throw Error('synthetic_control_cleanup_error'); } }) }));
import { runLiveSession } from '../scripts/live-session.mjs';
import { runTerminalCodex } from '../integrations/live-terminal.mjs';

beforeEach(() => { state.pollFailure = false; state.browserUnavailable = false; state.closeCalls = 0; state.closeResult = null; state.childCleanupFailure = false; state.noExitCleanupFailure = false; });

async function launch() {
  const page = new EventEmitter(), gateway = new EventEmitter(), child = new EventEmitter(), abort = new AbortController();
  let spawned; const ready = new Promise(resolve => { spawned = resolve; });
  const frame = { url: () => 'http://127.0.0.1:1/live.html' };
  page.url = frame.url; page.mainFrame = () => frame; page.exposeBinding = async () => {};
  page.isClosed = () => false; page.exposeFunction = async (_name, fn) => { page.stop = fn; };
  child.pid = 123; child.exitCode = null; child.signalCode = null;
  const live = { page, gateway, close: vi.fn(async () => {}), base: 'http://127.0.0.1:1', token: 'synthetic' };
  const running = runLiveSession({ signal: abort.signal, open: async () => live,
    runHost: options => runTerminalCodex({ ...options, reactiveProvider: null, host: { command: 'synthetic', args: [] },
      spawnClient: () => { spawned(); return child; } }) });
  void running.catch(() => {}); await ready;
  return { page, gateway, child, abort, live, running };
}

for (const [kind, code] of [['ui', 0], ['abort', 130], ['page', 1], ['gateway', 1], ['pagehide', 1], ['unknown', 1]]) {
  it(`keeps the explicit ${kind} shutdown outcome ${code}`, async () => {
    const route = await launch();
    if (kind === 'ui') route.page.stop('ui');
    if (kind === 'abort') route.abort.abort('untrusted private reason must not propagate');
    if (kind === 'page') route.page.emit('close');
    if (kind === 'gateway') route.gateway.emit('exit', 7);
    if (['pagehide', 'unknown'].includes(kind)) route.page.stop(kind);
    expect(await route.running).toBe(code); expect(route.live.close).toHaveBeenCalledOnce();
  });
}

for (const code of [0, 7]) {
  it(`preserves natural Native exit ${code}`, async () => {
    const route = await launch(); route.child.exitCode = code; route.child.emit('exit', code);
    route.page.stop('ui'); expect(await route.running).toBe(code);
  });
}

it('does not turn an earlier failure into success when the UI closes later', async () => {
  const route = await launch(); route.gateway.emit('exit', 9); route.page.stop('ui');
  expect(await route.running).toBe(1);
});
it('does not turn explicit stop into failure when cleanup stops the gateway', async () => {
  const route = await launch(); route.page.stop('ui'); route.gateway.emit('exit', 9);
  expect(await route.running).toBe(0);
});
it('does not hide a known browser evaluation failure behind a later UI stop', async () => {
  const route = await launch(); state.browserUnavailable = true; route.page.stop('ui');
  expect(await route.running).toBe(1);
});
it('does not hide a known browser evaluation failure behind a natural zero exit', async () => {
  const route = await launch(); state.browserUnavailable = true;
  route.child.exitCode = 0; route.child.emit('exit', 0);
  expect(await route.running).toBe(1);
});
it('preserves the primary Native error when owned cleanup also rejects', async () => {
  const route = await launch(); state.childCleanupFailure = true;
  route.child.emit('error', Error('synthetic_primary_failure'));
  await expect(route.running).rejects.toThrow('synthetic_primary_failure');
});
it('preserves Native child errors and cleanup errors', async () => {
  const route = await launch(); route.child.emit('error', Error('synthetic_child_error'));
  await expect(route.running).rejects.toThrow('synthetic_child_error');
  const next = await launch(); next.live.close.mockRejectedValueOnce(Error('synthetic_cleanup_error'));
  next.page.stop('ui'); await expect(next.running).rejects.toThrow('live_cleanup_failed');
});
for (const kind of ['poll-rejection', 'evaluation-unavailable', 'transport']) {
  it(`keeps ${kind} failure nonzero`, async () => {
    const route = await launch();
    if (kind === 'transport') state.transport.onFailure?.();
    else if (kind === 'poll-rejection') state.pollFailure = true;
    else state.browserUnavailable = true;
    try { expect(await Promise.race([route.running, new Promise(resolve => setTimeout(() => resolve('still_running'), 400))])).toBe(1); }
    finally { route.abort.abort(); await route.running; }
  });
}

it('awaits the original deferred transport cleanup and preserves its rejection', async () => {
  let release; state.closeResult = new Promise((_, reject) => { release = reject; });
  const route = await launch(); let settled = false; void route.running.finally(() => { settled = true; }).catch(() => {});
  route.page.stop('ui'); await new Promise(resolve => setImmediate(resolve));
  expect(settled).toBe(false); release(Error('synthetic_private_cleanup_error'));
  await expect(route.running).rejects.toThrow('live_cleanup_failed');
});
it('does not report UI success when Native child cleanup fails', async () => {
  state.childCleanupFailure = true; const route = await launch(); route.page.stop('ui');
  await expect(route.running).rejects.toThrow('live_cleanup_failed');
});
it('reports failed shutdown even when the Native child never emits exit', async () => {
  const route = await launch(); state.noExitCleanupFailure = true; route.page.stop('ui');
  const outcome = route.running.then(() => 'unexpected_success', error => error.message);
  try { expect(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('still_waiting'), 200))])).toBe('live_cleanup_failed'); }
  finally { route.child.signalCode = 'SIGTERM'; route.child.emit('exit', null); await route.running.catch(() => {}); }
});
it('attempts body cleanup when the optional Herdr control cleanup fails', async () => {
  const page = new EventEmitter(), gateway = new EventEmitter(), close = vi.fn(async () => {});
  page.exposeFunction = async () => {}; page.isClosed = () => false;
  const call = async () => ({ snapshot: { agents: [{ agent: 'codex', pane_id: 'synthetic' }], panes: [] } });
  await expect(runLiveSession({ agentPane: 'synthetic', launchCodex: false, call,
    open: async () => ({ page, gateway, close }) })).rejects.toThrow('live_cleanup_failed');
  expect(close).toHaveBeenCalledOnce();
});
