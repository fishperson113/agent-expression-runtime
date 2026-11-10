import { expect, it } from 'vitest';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { openLive } from '../integrations/live-launch.mjs';
import { gatewayExecutable } from '../scripts/start-session.mjs';

const scene = id => ({ parts: [{ id, kind: 'ellipsoid', center: [0, 0, 0], scale: [0.2, 0.3, 0.1] }],
  style: { color: '#1277aa', brightness: 0.8, pointSize: 1.2, dispersion: 0.1 }, flow: { field: 'pulse', strength: 0.1 }, goal: 'Synthetic private goal' });
const value = response => JSON.parse(response.content[0].text);
const edit = (client, operation, expectedRevision, creation) => client.tool('playground_edit',
  { operation, expectedRevision, ...(creation ? { scene: creation } : {}) });
function publish(reply, emit, admission = false) {
  for (const status of [...(admission ? ['accepted'] : []), 'applied', 'completed'])
    emit('feedback', { session: reply.session, epoch: reply.epoch, seq: reply.seq, status });
}

async function fixture() {
  let id = randomUUID(), epoch = randomUUID(), seq = 0;
  const state = { mode: 'early', expressions: [], controllers: 0, active: false, rejectedLate: 0 }, streams = new Set();
  const emit = (event, data) => { for (const stream of streams) stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer synthetic-token') { res.writeHead(401).end(); return; }
    if (req.url.endsWith('/events')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: snapshot\ndata: ${JSON.stringify({ session: id, epoch, seq, status: 'snapshot' })}\n\n`);
      streams.add(res); res.on('close', () => streams.delete(res)); return;
    }
    let text = ''; for await (const part of req) text += part;
    const body = text ? JSON.parse(text) : {};
    if (req.method === 'DELETE') {
      if (req.url.split('/').at(-1) !== id) { res.writeHead(404).end(); return; }
      state.active = false; emit('feedback', { session: id, epoch, seq, status: 'closed' });
      for (const stream of streams) stream.end(); res.writeHead(204).end(); return;
    }
    let reply;
    if (req.url === '/v1/sessions') {
      if (state.active) { res.writeHead(409, { 'Content-Type': 'application/json' }).end('{"code":"session_busy"}'); return; }
      state.active = true; id = randomUUID(); epoch = randomUUID(); seq = 0; state.controllers++; reply = { id, epoch };
    }
    else if (req.url.endsWith('/cancel')) { epoch = randomUUID(); seq = 0; reply = { id, epoch, status: 'cancelled' }; }
    else if (req.url.endsWith('/expressions')) {
      if (state.mode === 'late') { state.waiting = true; await delay(2600); }
      if (req.url.split('/')[3] !== id || body.epoch !== epoch || !state.active) {
        state.rejectedLate++; res.writeHead(409, { 'Content-Type': 'application/json' }).end('{"code":"stale_epoch"}'); return;
      }
      seq++; state.expressions.push(body); reply = { id: body.requestId, session: id, epoch, seq, status: 'accepted' };
      if (state.mode === 'gap') emit('gap', { status: 'gap', lost: 1 });
      if (['early', 'foreign'].includes(state.mode)) for (const status of ['applied', 'completed'])
        emit('feedback', { session: id, epoch: state.mode === 'foreign' ? randomUUID() : epoch, seq, status });
      if (state.mode.startsWith('pending')) {
        const accepted = { ...reply }; reply.status = 'pending';
        if (state.mode === 'pending-early') publish(accepted, emit, true);
        if (state.mode === 'pending') setTimeout(() => publish(accepted, emit, true), 50);
      }
      await delay(20);
    } else { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = liveTestClient(`http://127.0.0.1:${server.address().port}`, 'synthetic-token'); await client.call('initialize');
  return { state, client, close: async () => { await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

it('discovers the session playground through the existing Live MCP controller', async () => {
  const client = liveTestClient('http://127.0.0.1:1', 'synthetic-test-token');
  try {
    await client.call('initialize');
    const list = await client.call('tools/list');
    expect(list.tools.map(tool => tool.name)).toContain('playground_edit');
    expect(list.tools.map(tool => tool.name)).toContain('playground_state');
    expect(Buffer.byteLength(JSON.stringify(list))).toBeLessThan(1_000_000);
  } finally { await client.close(); }
});

it('runs real MCP plus HTTP/SSE co-create, remix, undo and reset with early feedback', async () => {
  const f = await fixture();
  try {
    for (const [operation, creation, revision] of [['create', scene('a'), 0], ['remix', scene('b'), 1], ['undo', undefined, 2], ['remix', scene('c'), 3], ['reset', undefined, 4]]) {
      if (operation === 'undo') toolValue(await f.client.tool('express', { body: { type: 'morph', target: 'wall', durationMs: 100 } }));
      expect(toolValue(await edit(f.client, operation, revision, creation))).toMatchObject({ status: 'committed', revision: revision + 1 });
    }
    const redacted = toolValue(await f.client.tool('playground_state'));
    expect(redacted).not.toHaveProperty('scene'); expect(JSON.stringify(redacted)).not.toContain('Synthetic private goal');
    expect(toolValue(await f.client.tool('playground_state', { includeScene: true })).scene).toEqual(scene('a'));
    expect(f.state.controllers).toBe(1);
    expect(f.state.expressions).toHaveLength(11);
    expect(new Set(f.state.expressions.map(entry => entry.requestId)).size).toBe(11);
    expect(f.state.expressions.every(entry => !Object.hasOwn(entry, 'phase'))).toBe(true);
    expect(JSON.stringify(f.state.expressions)).not.toContain('Synthetic private goal');
  } finally { await f.close(); }
}, 15000);

it.each(['gap', 'timeout', 'foreign', 'pending-never'])('keeps %s uncertain and recovers only through owned epoch invalidation', async mode => {
  const f = await fixture(); f.state.mode = mode;
  try {
    const failed = await edit(f.client, 'create', 0, scene('a'));
    expect(failed.isError).toBe(true); expect(value(failed)).toMatchObject({ status: 'uncertain', revision: 0, recoveryRequired: true });
    if (mode === 'pending-never') expect(f.state.expressions).toHaveLength(1);
    expect((await edit(f.client, 'create', 0, scene('b'))).isError).toBe(true);
    const calls = f.state.expressions.length; await delay(30); expect(f.state.expressions).toHaveLength(calls);
    expect(toolValue(await edit(f.client, 'recover', 0))).toMatchObject({ status: 'recovered', revision: 0 });
    f.state.mode = 'early';
    expect(toolValue(await edit(f.client, 'create', 0, scene('fresh')))).toMatchObject({ status: 'committed', revision: 1 });
    expect(f.state.controllers).toBe(2);
  } finally { await f.close(); }
}, 15000);

it.each(['pending', 'pending-early'])('resolves %s admission through SSE without repeating either POST', async mode => {
  const f = await fixture(); f.state.mode = mode;
  try {
    expect(toolValue(await edit(f.client, 'create', 0, scene('a')))).toMatchObject({ status: 'committed', revision: 1 });
    expect(f.state.expressions).toHaveLength(2);
    expect(new Set(f.state.expressions.map(entry => entry.requestId)).size).toBe(2);
  } finally { await f.close(); }
}, 15000);

it.each(['timeout', 'pending-never'])('keeps cancellation responsive while %s playground work is pending', async mode => {
  const f = await fixture(); f.state.mode = mode;
  try {
    const pending = edit(f.client, 'create', 0, scene('a'));
    await expect.poll(() => f.state.expressions.length, { timeout: 2500 }).toBe(mode === 'pending-never' ? 1 : 2);
    const before = performance.now();
    toolValue(await f.client.tool('cancel_expression'));
    expect(performance.now() - before).toBeLessThan(1500);
    expect(value(await pending)).toMatchObject({ status: 'uncertain', revision: 0, recoveryRequired: true });
    expect(toolValue(await f.client.tool('playground_state')).revision).toBe(0);
  } finally { await f.close(); }
}, 15000);

it('invalidates a queued playground request when user cancellation arrives before dispatch', async () => {
  const f = await fixture(); f.state.mode = 'pending-never';
  try {
    const pending = edit(f.client, 'create', 0, scene('obsolete'));
    const before = performance.now();
    toolValue(await f.client.tool('cancel_expression'));
    expect(performance.now() - before).toBeLessThan(1500);
    const outcome = value(await pending);
    expect(['uncertain', 'rejected']).toContain(outcome.status);
    expect(f.state.expressions.length).toBeLessThanOrEqual(1);
  } finally { await f.close(); }
}, 15000);

it('revokes the captured owner before newer ordinary work when an old POST arrives late', async () => {
  const f = await fixture(); f.state.mode = 'late';
  try {
    const pending = edit(f.client, 'create', 0, scene('obsolete'));
    await expect.poll(() => f.state.waiting).toBe(true);
    expect(value(await pending).status).toBe('uncertain');
    f.state.mode = 'early';
    expect(toolValue(await f.client.tool('express', { body: { type: 'morph', target: 'wall', durationMs: 100 } })).status).toBe('accepted');
    await expect.poll(() => f.state.rejectedLate, { timeout: 3000 }).toBe(1);
    expect(f.state.controllers).toBe(2);
    expect(f.state.expressions).toHaveLength(1);
    expect(f.state.expressions[0].body.target).toBe('wall');
  } finally { await f.close(); }
}, 15000);

const requireGateway = process.env.FISCH_PLAYGROUND_REQUIRE_GATEWAY === '1';
it.skipIf(!existsSync(gatewayExecutable()) && !requireGateway)('applies and undoes actual rendered geometry through one Rust gateway and MCP', async () => {
  expect(existsSync(gatewayExecutable()), 'Build the standalone gateway for required E2E').toBe(true);
  const live = await openLive({ headless: true, assets: false }); let client;
  try {
    client = liveTestClient(live.base, live.token); await client.call('initialize');
    for (const [operation, creation, revision, part] of [['create', scene('a'), 0, 'a'], ['remix', scene('b'), 1, 'b'], ['undo', undefined, 2, 'a'], ['reset', undefined, 3, 'a']]) {
      if (operation === 'undo') toolValue(await client.tool('express', { body: { type: 'morph', target: 'wall', durationMs: 100 } }));
      expect(toolValue(await edit(client, operation, revision, creation)).status).toBe('committed');
      await expect.poll(() => live.page.evaluate(() => window.fischLive.metrics().parts)).toEqual([part]);
    }
    expect(await live.page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    const metrics = await live.page.evaluate(() => window.fischLive.metrics());
    expect(metrics.diagnostics.events.filter(event => event.phase === 'completed').length).toBeGreaterThanOrEqual(8);
  } finally { await client?.close(); await live.close(); }
}, 90000);

it.skipIf(!existsSync(gatewayExecutable()) && !requireGateway)('handles actual user cancel and fresh recovery without replaying the interrupted creation', async () => {
  const live = await openLive({ headless: true, assets: false }); let client;
  try {
    client = liveTestClient(live.base, live.token); await client.call('initialize');
    const pending = edit(client, 'create', 0, scene('interrupted'));
    await expect.poll(() => live.page.evaluate(() => window.fischLive.metrics().parts)).toEqual(['interrupted']);
    await live.page.locator('#cancel').click();
    expect(value(await pending)).toMatchObject({ status: 'uncertain', recoveryRequired: true });
    expect((await edit(client, 'create', 0, scene('stale'))).isError).toBe(true);
    expect(toolValue(await edit(client, 'recover', 0)).status).toBe('recovered');
    expect(toolValue(await edit(client, 'create', 0, scene('new'))).status).toBe('committed');
    await expect.poll(() => live.page.evaluate(() => window.fischLive.metrics().parts)).toEqual(['new']);
  } finally { await client?.close(); await live.close(); }
}, 90000);

it.skipIf(!existsSync(gatewayExecutable()) && !requireGateway)('times out honestly when user motion-off prevents actual scheduler completion', async () => {
  const live = await openLive({ headless: true, assets: false }); let client;
  try {
    client = liveTestClient(live.base, live.token); await client.call('initialize');
    await live.page.locator('#motion').selectOption('off');
    const failed = await edit(client, 'create', 0, scene('not-completed'));
    expect(failed.isError).toBe(true);
    expect(value(failed)).toMatchObject({ status: 'uncertain', recoveryRequired: true, revision: 0 });
    expect(await live.page.locator('#motion').inputValue()).toBe('off');
    expect(await live.page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    await live.page.locator('#motion').selectOption('normal');
    expect(toolValue(await edit(client, 'recover', 0)).status).toBe('recovered');
    expect(toolValue(await edit(client, 'create', 0, scene('requested-fresh'))).status).toBe('committed');
  } finally { await client?.close(); await live.close(); }
}, 90000);

async function heldBodyProxy(base) {
  const state = { expressions: 0, held: false, release: () => {} };
  const server = createServer((req, res) => {
    const target = new URL(req.url, base);
    const upstream = httpRequest(target, { method: req.method, headers: { ...req.headers, host: target.host } }, reply => {
      const send = () => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); };
      if (req.method === 'POST' && target.pathname.endsWith('/expressions') && ++state.expressions === 1) {
        state.held = true; state.release = () => { state.held = false; state.release = () => {}; if (!res.destroyed) send(); };
      } else send();
    });
    upstream.on('error', () => { if (!res.destroyed) res.destroy(); });
    res.on('close', () => upstream.destroy()); req.pipe(upstream);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, base: `http://127.0.0.1:${server.address().port}`,
    close: async () => { state.release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
it.skipIf(!existsSync(gatewayExecutable()))('commits through actual Rust and WebGL while the first HTTP receipt is held but correlated SSE admission flows', async () => {
  const live = await openLive({ headless: true, assets: false, production: false }); let proxy, client;
  try {
    proxy = await heldBodyProxy(live.base); client = liveTestClient(proxy.base, live.token); await client.call('initialize');
    const result = toolValue(await edit(client, 'create', 0, scene('correlated-creation')));
    expect(result).toMatchObject({ status: 'committed', revision: 1, recoveryRequired: false });
    expect(proxy.state.held).toBe(true); expect(proxy.state.expressions).toBe(2);
    const events = await live.page.evaluate(() => window.fischLive.metrics().diagnostics.events);
    for (const seq of [1, 2]) for (const phase of ['applied', 'completed'])
      expect(events.some(event => event.origin === 'native' && event.seq === seq && event.phase === phase)).toBe(true);
    expect(await live.page.evaluate(() => window.fischLive.metrics().parts)).toEqual(['correlated-creation']);
    proxy.state.release(); await delay(50);
    expect(toolValue(await client.tool('playground_state', {}))).toMatchObject({ revision: 1, recoveryRequired: false });
    expect(proxy.state.expressions).toBe(2);
  } finally { await client?.close(); await proxy?.close(); await live.close(); }
}, 90000);
