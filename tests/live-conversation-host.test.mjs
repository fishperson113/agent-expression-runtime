import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';
import { runTerminalCodex } from '../integrations/live-terminal.mjs';
import { runLiveSession } from '../scripts/live-session.mjs';
import { openLive } from '../integrations/live-launch.mjs';
import { gatewayExecutable } from '../scripts/start-session.mjs';
const fixture = fileURLToPath(new URL('./fixtures/conversation-host-agent.mjs', import.meta.url));
async function browserRoute({ expression = false } = {}) {
  const abort = new AbortController(); let live, child, next, tag = 0;
  const running = runLiveSession({ headless: true, assets: false, signal: abort.signal,
    open: options => openLive({ ...options, production: false, synthetic: true }),
    runHost: options => { live = options.live; return runTerminalCodex({ ...options, reactiveProvider: null,
      host: { command: process.execPath, args: [expression ? fileURLToPath(new URL('./fixtures/playground-agent.mjs', import.meta.url)) : fixture] }, spawnClient: (command, args, settings) => {
        child = spawn(command, args, { ...settings, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stderr.resume(); next = inbox(child); return child;
      } }); } });
  void running.catch(() => {});
  const close = async () => { abort.abort(); child?.stdin.end(); await running.catch(() => {}); };
  try {
    await vi.waitFor(() => expect(next).toBeTypeOf('function'), { timeout: 60000 });
    const ready = await next(value => value.type === 'ready');
    const call = async (method, params = {}) => { const own = ++tag;
      child.stdin.write(JSON.stringify({ method, params, tag: own }) + '\n');
      return (await next(value => value.type === 'reply' && value.tag === own)).value;
    };
    return { live, call, close, next, ready, running };
  } catch (error) { await close(); throw error; }
}
function inbox(child) {
  const values = [], waiters = []; let buffer = '';
  child.stdout.on('data', bytes => { buffer += bytes; let end;
    if (buffer.length > 1048576) throw Error('synthetic_output_limit');
    while ((end = buffer.indexOf('\n')) >= 0) { const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      values.push(value); if (values.length > 64) values.shift(); for (const resolve of waiters.splice(0)) resolve(); } });
  return async predicate => { for (let i = 0; i < 100; i++) { const found = values.find(predicate); if (found) return found;
    await new Promise(resolve => { const timer = setTimeout(resolve, 50); waiters.push(() => { clearTimeout(timer); resolve(); }); }); } throw Error('synthetic_timeout'); };
}
async function start({ silent = false } = {}) {
  const page = new EventEmitter(), abort = new AbortController(), bindings = new Map(), snapshots = [];
  let child, next, tag = 0; const previous = globalThis.window;
  const api = { intent: 0, clears: 0, draft: '', last: undefined, available: false, busy: false,
    activity() {}, logActivity() {}, setupStatus() {}, configureReactive(value) { this.available = value; }, setReactiveUserBusy(value) { this.busy = value; },
    selectThread() { this.intent++; }, playgroundClear() {}, conversationClear() { this.clears++; this.draft = ''; this.last = undefined; },
    conversationStatus(value) { this.last = structuredClone(value); snapshots.push(this.last); if (snapshots.length > 32) snapshots.shift(); },
    async reactiveUserIntent() { this.intent++; }, takeReactiveRequest() { return null; } };
  const frame = { url: () => 'http://127.0.0.1:1/live.html' };
  page.url = frame.url; page.mainFrame = () => frame; page.isClosed = () => false;
  page.exposeBinding = async (name, callback) => bindings.set(name, callback);
  page.evaluate = async (fn, value) => fn(value); globalThis.window = { fischLive: api };
  const running = runTerminalCodex({ live: { page, base: 'http://127.0.0.1:1', token: 'synthetic' }, cwd: process.cwd(), signal: abort.signal,
    reactiveProvider: null, host: { command: process.execPath, args: [fixture, ...(silent ? ['--silent'] : [])] },
    spawnClient: (command, args, options) => { child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] }); child.stderr.resume(); next = inbox(child); return child; } });
  void running.catch(() => {});
  const close = async () => { abort.abort(); child?.stdin.end(); await running.catch(() => {}); globalThis.window = previous; };
  try { await vi.waitFor(() => expect(next).toBeTypeOf('function')); await next(value => value.type === 'ready');
    const call = async (method, params = {}) => { const own = ++tag; child.stdin.write(JSON.stringify({ method, params, tag: own }) + '\n');
      return (await next(value => value.type === 'reply' && value.tag === own)).value; };
    const invoke = value => bindings.get('fischLiveConversation')({ page, frame }, value);
    return { page, frame, api, snapshots, call, invoke, close, bindings, next };
  } catch (error) { await close(); throw error; }
}
it('awaits the selected-thread revocation before releasing the Native reply', async () => {
  const f = await start(); let release;
  try {
    f.api.selectThread = () => new Promise(resolve => { release = resolve; });
    let replied = false; const selection = f.call('thread/start').then(() => { replied = true; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await new Promise(resolve => setTimeout(resolve, 30)); expect(replied).toBe(false);
    release(); await selection; expect(replied).toBe(true);
  } finally { release?.(); await f.close(); }
});
it('keeps the isolated observer available cold, but fences unknown intent across held authorization', async () => {
  const previous = globalThis.window;
  for (const unknown of [false, true]) {
    const request = { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'r', intentRevision: 0, presenceRevision: 1, deadline: 1000, requiredTrackIds: [] };
    const candidate = { request, observationWindow: { schemaVersion: 1, request: { ...request }, events: [{ id: 1, type: 'user_arrived', at: 100 }],
      observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100, camera: 'absent', turn: 'idle', summary: 'local',
        user: { present: false, quality: { score: 0, basis: 'unavailable' }, position: null, head: null, expression: null, facingScreen: null, mouthMoving: null } }] } };
    let release, calls = 0, taken = false, error = ''; const deliveries = [];
    const api = { conversationDocument: 'doc', conversationStatus() {}, activity() {}, configureReactive() {}, setReactiveUserBusy() {}, reactiveUserIntent() {},
      takeReactiveRequest() { if (taken) return null; taken = true; return candidate; }, authorizeReactiveRequest: () => new Promise(resolve => { release = resolve; }),
      deliverReactiveDecision(id, data) { deliveries.push(data); return { reason: 'revoked' }; }, failReactiveDecision() {} };
    globalThis.window = { fischLive: api };
    const broker = new LiveReactiveBroker({ page: { evaluate: async (fn, value) => fn(value) }, provider: { decide: async () => { calls++; return { mode: 'observe' }; } },
      output: { thread: 't' }, forward() {}, reject() {} });
    try {
      await broker.poll({}, [], () => ({ token: 'doc', snapshot: { available: false, pending: false, stopping: false, error } }));
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      if (unknown) { broker.client({ id: 'user', method: 'turn/start', params: { threadId: 't' } });
        await new Promise(resolve => setTimeout(resolve, 0)); broker.pending.delete('user'); error = 'conversation_unknown'; }
      release(true); await vi.waitFor(() => expect(deliveries).toHaveLength(1)); expect(calls).toBe(unknown ? 0 : 1);
    } finally { broker.close(); globalThis.window = previous; }
  }
});
it('binds actual host sends, canonical ACK-only cancellation, notifications and confirmed thread changes', async () => {
  const f = await start();
  try {
    expect(f.bindings.has('fischLiveConversation')).toBe(true);
    await vi.waitFor(() => expect(f.api.last?.canSend).toBe(true));
    const generation = f.api.last.generation;
    expect(await f.invoke({ action: 'send', generation, text: 'Public synthetic request.' })).toEqual({ status: 'accepted' });
    await vi.waitFor(() => expect(f.api.last?.messages).toHaveLength(2)); expect(f.api.last.canCancel).toBe(true);
    expect(f.api.last.messages.map(value => value.text)).toEqual(['Public synthetic request.', 'Public synthetic reply.']);
    await f.call('test/approval'); await vi.waitFor(() => expect(f.api.last.waiting).toBe(true));
    expect(await f.invoke({ action: 'cancel', generation })).toEqual({ status: 'stopping' });
    await vi.waitFor(() => expect(f.api.last.canCancel).toBe(false)); expect(f.api.last.messages.every(value => value.status === 'interrupted')).toBe(true);
    f.api.draft = 'Public unsent draft'; const clears = f.api.clears;
    await f.call('thread/resume', { threadId: 'missing' }); await f.call('thread/resume', { threadId: 'thread-1' });
    expect(f.api.draft).toBe('Public unsent draft'); expect(f.api.clears).toBe(clears);
    await f.call('thread/start'); await vi.waitFor(() => expect(f.api.last?.generation).toBeGreaterThan(generation));
    expect(f.api.draft).toBe(''); expect(f.api.last.messages).toEqual([]);
    const state = (await f.call('test/snapshot')).result;
    expect(state.seen.filter(value => value.method === 'turn/start')).toHaveLength(1); expect(state.keys).toEqual([]);
  } finally { await f.close(); }
});
it('publishes a late canonical Cancel without a revision change while unknown send stays sticky', async () => {
  const f = await start({ silent: true });
  try {
    await vi.waitFor(() => expect(f.api.last?.canSend).toBe(true)); const generation = f.api.last.generation;
    const outcome = f.invoke({ action: 'send', generation, text: 'Public synthetic unknown request.' }).catch(error => error.message);
    await f.next(value => value.type === 'event' && value.value.method === 'test/sent');
    expect(await outcome).toBe('conversation_unknown'); await vi.waitFor(() => expect(f.api.last.error).toBe('conversation_unknown'));
    const revision = f.api.last.revision; await f.call('test/late');
    await vi.waitFor(() => expect(f.api.last.canCancel).toBe(true)); expect(f.api.last.revision).toBe(revision);
    expect(f.api.last.canSend).toBe(false); expect(f.api.busy).toBe(true);
    await expect(f.invoke({ action: 'send', generation, text: 'Do not resend' })).rejects.toThrow('conversation_unavailable');
    expect((await f.call('test/snapshot')).result.seen.filter(value => value.method === 'turn/start')).toHaveLength(1);
  } finally { await f.close(); }
}, 20000);
it('revokes the binding on reload and publishes an actionable empty restart state', async () => {
  const f = await start();
  try {
    await vi.waitFor(() => expect(f.api.last?.canSend).toBe(true)); const generation = f.api.last.generation;
    f.page.emit('request', { isNavigationRequest: () => true, frame: () => f.frame });
    delete f.api.conversationDocument; f.api.last = undefined;
    await vi.waitFor(() => expect(f.api.last?.error).toBe('conversation_restart_required'));
    expect(f.api.last.messages).toEqual([]); expect(f.api.last.available).toBe(false);
    await f.call('thread/start'); await vi.waitFor(() => expect(f.api.last?.error).toBe('conversation_restart_required'));
    expect(f.api.last.canSend).toBe(false);
    await expect(f.invoke({ action: 'send', generation, text: 'Public stale callback' })).rejects.toThrow('conversation_unavailable');
  } finally { await f.close(); }
});

const requireBrowserGateway = process.env.FISCH_PLAYGROUND_REQUIRE_GATEWAY === '1';
it.skipIf(!existsSync(gatewayExecutable()) && !requireBrowserGateway)('sends and interrupts through the actual Live DOM, relay and Native fixture, then fences selection and reload', async () => {
  let route = await browserRoute(); const page = route.live.page;
  try {
    const chat = page.locator('.fisch-conversation'), input = chat.locator('textarea');
    const send = chat.getByRole('button', { name: 'Gửi', exact: true });
    const cancel = chat.getByRole('button', { name: 'Dừng trả lời', exact: true });
    await expect.poll(() => input.isEnabled(), { timeout: 5000 }).toBe(true);
    await input.fill('Public browser request.');
    await expect.poll(() => send.isEnabled(), { timeout: 5000 }).toBe(true); await input.press('Control+Enter');
    expect(await input.evaluate(node => node === document.activeElement)).toBe(true);
    await expect.poll(() => chat.locator('ol').textContent()).toContain('Public synthetic reply.');
    expect(await chat.locator('ol').textContent()).toContain('Public browser request.');
    expect(await input.inputValue()).toBe('');
    await expect.poll(() => cancel.isEnabled()).toBe(true); await cancel.click();
    await expect.poll(() => chat.locator('ol').textContent()).toContain('Đã ngắt');
    await input.fill('Public preserved draft.');
    await route.call('thread/resume', { threadId: 'missing' });
    await route.call('thread/resume', { threadId: 'thread-1' });
    expect(await input.inputValue()).toBe('Public preserved draft.');
    await route.call('thread/start');
    await expect.poll(() => input.inputValue()).toBe(''); expect(await chat.locator('ol').textContent()).toBe('');
    const snapshot = (await route.call('test/snapshot')).result;
    expect(snapshot.seen.filter(value => value.method === 'turn/start')).toHaveLength(1);
    expect(snapshot.seen.filter(value => value.method === 'turn/interrupt')).toHaveLength(1);
    expect(snapshot.keys).toEqual([]);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    expect(await page.evaluate(() => window.fischLive.metrics().cameraActive)).toBe(false);
    await input.fill('Public reload draft.'); await page.reload().catch(() => {});
    expect(await route.running).toBe(1); expect(route.live.browser.isConnected()).toBe(false);
    expect(route.live.gateway.exitCode !== null || route.live.gateway.signalCode !== null).toBe(true);
    await route.close(); route = await browserRoute();
    const fresh = route.live.page.locator('.fisch-conversation');
    await expect.poll(() => fresh.locator('textarea').isEnabled()).toBe(true);
    expect(await fresh.locator('textarea').inputValue()).toBe(''); expect(await fresh.locator('ol').textContent()).toBe('');
    expect((await route.call('test/snapshot')).result.seen.filter(value => value.method === 'turn/start')).toEqual([]);
  } finally { await route.close(); }
}, 90000);

it.skipIf(!existsSync(gatewayExecutable()) && !requireBrowserGateway)('uses the chat DOM to invoke a scripted agent expression through actual MCP without projecting tool output as chat', async () => {
  const route = await browserRoute({ expression: true }), page = route.live.page;
  try {
    expect(route.ready.tools).toContain('express'); expect(route.ready.tools).toContain('observe');
    const chat = page.locator('.fisch-conversation'), input = chat.locator('textarea');
    await expect.poll(() => input.isEnabled(), { timeout: 5000 }).toBe(true);
    await input.fill(JSON.stringify({ operation: 'express' }));
    await input.press('Meta+Enter');
    const result = await route.next(value => value.type === 'result' && value.command === 'express');
    expect(result.value.status).toBe('accepted');
    await expect.poll(() => page.evaluate(() => window.fischLive.metrics().scene)).toBe('wall');
    const metrics = await page.evaluate(() => window.fischLive.metrics());
    expect(metrics.diagnostics.events.some(event => event.origin === 'native' && event.phase === 'applied')).toBe(true);
    await expect.poll(() => page.evaluate(() => window.fischLive.metrics().diagnostics.events.some(event =>
      event.origin === 'native' && event.phase === 'frame_changed_proxy'))).toBe(true);
    expect(await chat.locator('ol').textContent()).toBe('');
    expect(metrics.cameraActive).toBe(false);
    if (process.env.FISCH_CHAT_EXPRESSION_SCREENSHOT) await page.screenshot({ path: process.env.FISCH_CHAT_EXPRESSION_SCREENSHOT });
  } finally { await route.close(); }
}, 90000);
