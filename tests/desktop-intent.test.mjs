import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { createDesktopIntentClient, startDesktopIntentServer } from '../integrations/desktop-intent.mjs';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';
const token = 'a'.repeat(64), owned = [], headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
afterEach(async () => { for (const close of owned.splice(0).reverse()) await close(); });
async function server(options = {}) { const value = await startDesktopIntentServer({ token, onBegin() {}, ...options }); owned.push(() => value.close()); return value; }
const post = (base, path, body, extra = {}) => fetch(base + '/v1/intent/' + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
it('counts a lease before the renderer barrier and acknowledges only after it succeeds', async () => {
  const gate = Promise.withResolvers(), begin = vi.fn(() => gate.promise), end = vi.fn(), s = await server({ onBegin: begin, onEnd: end });
  const client = createDesktopIntentClient({ base: s.base, token }); let acknowledged = false;
  const pending = client.begin().then(value => { acknowledged = true; return value; });
  await vi.waitFor(() => expect(begin).toHaveBeenCalledOnce()); expect(s.busy()).toBe(true); expect(acknowledged).toBe(false);
  gate.resolve(); const lease = await pending; expect(acknowledged).toBe(true);
  await client.end(lease); expect(end).toHaveBeenCalledWith({ busy: false, uncertain: false }); expect(s.busy()).toBe(false); expect(s.uncertain()).toBe(false);
  expect((await post(s.base, 'end', { leaseId: lease })).status).toBe(409);
});
it('rejects unauthenticated, Origin-bearing, malformed and oversized requests before callbacks', async () => {
  const begin = vi.fn(), s = await server({ onBegin: begin });
  expect((await post(s.base, 'begin', {}, { Authorization: 'Bearer invalid' })).status).toBe(403);
  expect((await post(s.base, 'begin', {}, { Origin: 'http://localhost' })).status).toBe(403);
  expect((await post(s.base, 'begin', { text: 'do not store' })).status).toBe(400);
  expect((await post(s.base, 'end', { leaseId: 'wrong' })).status).toBe(400);
  await post(s.base, 'begin', { text: 'x'.repeat(1024) }).then(value => expect(value.ok).toBe(false), () => {});
  expect(begin).not.toHaveBeenCalled(); expect(s.busy()).toBe(false); expect(s.uncertain()).toBe(false);
});
it('bounds concurrent leases and unknown end never releases another owner', async () => {
  const s = await server(), client = createDesktopIntentClient({ base: s.base, token });
  const leases = await Promise.all(Array.from({ length: 8 }, () => client.begin()));
  await expect(client.begin()).rejects.toThrow('desktop_intent_unavailable'); expect(s.busy()).toBe(true);
  expect((await post(s.base, 'end', { leaseId: '0'.repeat(36) })).status).toBe(409);
  for (const lease of leases.slice(0, 7)) await client.end(lease);
  expect(s.busy()).toBe(true); await client.end(leases[7]); expect(s.busy()).toBe(false);
});
it('keeps begin, end and uncertainty payloads bound to their exact route without changing owner state', async () => {
  const begin = vi.fn(), end = vi.fn(), s = await server({ onBegin: begin, onEnd: end });
  const client = createDesktopIntentClient({ base: s.base, token }), lease = await client.begin();
  expect((await post(s.base, 'begin', { leaseId: lease })).status).toBe(400);
  expect((await post(s.base, 'uncertain', {})).status).toBe(400);
  expect((await post(s.base, 'end', {})).status).toBe(400);
  expect((await post(s.base, 'begin', {}, { 'Content-Type': 'text/plain' })).status).toBe(415);
  expect((await fetch(s.base + '/v1/intent/begin', { headers })).status).toBe(404);
  expect((await post(s.base, 'unknown', { leaseId: lease })).status).toBe(404);
  expect(s.busy()).toBe(true); expect(s.uncertain()).toBe(false);
  expect(begin).toHaveBeenCalledOnce(); expect(end).not.toHaveBeenCalled();
  await client.end(lease); expect(s.busy()).toBe(false);
});
it('expiry frees capacity but latches uncertainty instead of silently resuming the observer', async () => {
  const timers = new Map(), pause = vi.fn(), leaseTimers = { set: fn => { const key = {}; timers.set(key, fn); return key; }, clear: key => timers.delete(key) };
  const s = await server({ leaseTimers, onUncertain: pause }), client = createDesktopIntentClient({ base: s.base, token });
  await client.begin(); expect(timers.size).toBe(1); [...timers.values()][0]();
  expect(s.busy()).toBe(false); expect(s.uncertain()).toBe(true); expect(pause).toHaveBeenCalledWith('lease_expired');
  const later = await client.begin(); await client.end(later); expect(s.uncertain()).toBe(true); expect(s.busy()).toBe(false);
});
it('barrier timeout fails closed and a late callback cannot produce a mutation permit', async () => {
  const gate = Promise.withResolvers(), s = await server({ onBegin: () => gate.promise, callbackTimeoutMs: 10 });
  await expect(createDesktopIntentClient({ base: s.base, token }).begin()).rejects.toThrow('desktop_intent_unavailable');
  expect(s.uncertain()).toBe(true); expect(s.busy()).toBe(false); gate.resolve();
  await Promise.resolve(); expect(s.uncertain()).toBe(true);
});
it('a lost end response latches observer uncertainty even when its callback later completes', async () => {
  const gate = Promise.withResolvers(), ending = vi.fn(() => gate.promise), s = await server({ onEnd: ending });
  const client = createDesktopIntentClient({ base: s.base, token, timeoutMs: 30 }), lease = await client.begin();
  await expect(client.end(lease)).rejects.toThrow('desktop_intent_end_unknown');
  await vi.waitFor(() => expect(s.uncertain()).toBe(true)); gate.resolve();
  await vi.waitFor(() => expect(s.busy()).toBe(false)); expect(s.uncertain()).toBe(true);
});
async function gateway() {
  const state = { requests: [], expressions: 0, streams: new Set() };
  const http = createServer(async (request, response) => {
    state.requests.push(request.url);
    if (request.url.endsWith('/events')) { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(': ready\n\n'); state.streams.add(response); response.on('close', () => state.streams.delete(response)); return; }
    let text = ''; for await (const chunk of request) text += chunk;
    if (request.url.endsWith('/expressions') && state.rejectExpressions) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code: 'fixture_mutation_rejected' })); return; }
    const result = request.url === '/v1/sessions' ? { id: 'owner', epoch: 'epoch-1' }
      : request.url.endsWith('/expressions') ? { session: 'owner', epoch: 'epoch-1', seq: ++state.expressions, status: 'accepted' } : {};
    response.writeHead(request.method === 'DELETE' ? 204 : 200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  owned.push(async () => { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); });
  return { base: 'http://127.0.0.1:' + http.address().port, state };
}
async function mcp(control) {
  const g = await gateway(), client = liveTestClient(g.base, token, { env: { FISCH_MCP_REQUIRE_THREAD: '1', FISCH_DESKTOP_INTENT_BASE: control.base } });
  owned.push(() => client.close()); const initialized = await client.call('initialize');
  expect(initialized.instructions).toContain('independent camera observer');
  const invoke = (name, args = {}, thread = 'thread-one') => client.call('tools/call', { name, arguments: args, _meta: { threadId: thread } });
  return { ...g, client, invoke };
}
const command = { requestId: 'fenced-expression', body: { type: 'style', color: '#31dcf5', durationMs: 100 } };
it('real stdio waits for its fence before any gateway side effect; invalid and read-only tools do not fence', async () => {
  const gate = Promise.withResolvers(), begin = vi.fn(() => gate.promise), s = await server({ onBegin: begin }), m = await mcp(s);
  expect((await m.invoke('express', command)).isError).toBe(true);
  await m.invoke('bind_controller');
  expect((await m.invoke('express', command, 'foreign')).isError).toBe(true);
  expect((await m.invoke('compose_expression', { base: 'none', parts: [{ invalid: true }] })).isError).toBe(true);
  expect((await m.invoke('express', { ...command, expectedEpoch: 'old' })).isError).toBe(true);
  await m.invoke('expression_status', { requestId: 'never-sent' });
  expect(begin).not.toHaveBeenCalled(); expect(m.state.requests).toEqual([]);
  for (const name of ['observe', 'inspect_expression', 'look', 'playground_state']) await m.invoke(name, name === 'look' ? { reason: 'qa only' } : {});
  expect(begin).not.toHaveBeenCalled(); const requests = m.state.requests.length;
  const pending = m.invoke('express', command); await vi.waitFor(() => expect(begin).toHaveBeenCalledOnce());
  expect(m.state.requests).toHaveLength(requests); expect(s.busy()).toBe(true);
  gate.resolve(); expect(toolValue(await pending).status).toBe('accepted');
  expect(m.state.expressions).toBe(1); expect(s.busy()).toBe(false);
});
it('failed begin prevents forwarding; unknown end retains the actual result and pauses only observer work', async () => {
  const rejected = await server({ onBegin() { throw Error('private error'); } }), blocked = await mcp(rejected);
  await blocked.invoke('bind_controller'); expect((await blocked.invoke('express', command)).content[0].text).toContain('desktop_intent_unavailable');
  expect(blocked.state.requests).toEqual([]); expect(rejected.uncertain()).toBe(true);
  let ends = 0; const s = await server({ onEnd() { if (++ends === 1) throw Error('private error'); } }), m = await mcp(s);
  await m.invoke('bind_controller'); const value = await m.invoke('express', command);
  expect(value.isError).toBe(true); expect(JSON.parse(value.content[0].text).status).toBe('accepted');
  expect(JSON.parse(value.content[1].text)).toEqual({ status: 'uncertain', code: 'desktop_intent_end_unknown', retry: false });
  expect(m.state.expressions).toBe(1); expect(s.uncertain()).toBe(true);
  expect(toolValue(await m.invoke('express', { ...command, requestId: 'next-main-command' })).status).toBe('accepted');
  expect(m.state.expressions).toBe(2); expect(s.uncertain()).toBe(true);
});
it('keeps a known mutation rejection alongside end uncertainty without exposing barrier errors', async () => {
  const s = await server({ onEnd() { throw Error('PRIVATE_BARRIER_DETAIL'); } }), m = await mcp(s);
  m.state.rejectExpressions = true; await m.invoke('bind_controller');
  const value = await m.invoke('express', command);
  expect(value.isError).toBe(true);
  expect(JSON.parse(value.content[0].text)).toMatchObject({ status: 'rejected', code: 'fixture_mutation_rejected' });
  expect(JSON.parse(value.content[1].text)).toEqual({ status: 'uncertain', code: 'desktop_intent_end_unknown', retry: false });
  expect(JSON.stringify(value)).not.toContain('PRIVATE_BARRIER_DETAIL'); expect(s.uncertain()).toBe(true);
  expect(m.state.requests.filter(path => path.endsWith('/expressions'))).toHaveLength(1);
});
