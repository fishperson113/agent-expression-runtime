import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';
async function fixture(work, holdEvents = false, holdPosts = false) {
  const state = { creates: 0, posts: [], epoch: randomUUID(), id: randomUUID(), cancels: 0, streams: new Set() }; let release, seen;
  let postSeen; state.posted = new Promise(resolve => { postSeen = resolve; });
  state.releasePosts = new Promise(resolve => { state.releasePost = resolve; });
  state.events = new Promise(resolve => { seen = resolve; });
  const server = createServer(async (request, response) => {
    if (request.url.endsWith('/events')) {
      const start = () => { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(': ready\n\n'); state.streams.add(response); response.on('close', () => state.streams.delete(response)); };
      release = start; seen(); if (!holdEvents) start(); return;
    }
    if (request.url.includes('/observe')) { response.writeHead(404, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code: 'session_closed' })); return; }
    let text = ''; for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : {};
    let result = {};
    if (request.url === '/v1/sessions') { state.creates++; result = { id: state.id, epoch: state.epoch }; }
    else if (request.url.endsWith('/cancel')) { state.epoch = randomUUID(); state.cancels++; result = { id: state.id, epoch: state.epoch, status: 'cancelled' }; }
    else if (request.url.endsWith('/expressions')) { state.posts.push(body); postSeen(); if (holdPosts) await state.releasePosts; result = { session: state.id, epoch: state.epoch, seq: state.posts.length, status: 'accepted' }; }
    if (request.url.endsWith('/expressions')) for (const stream of state.streams) for (const status of ['accepted', 'applied', 'completed'])
      stream.write(`event: feedback\ndata: ${JSON.stringify({ ...result, status })}\n\n`);
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = liveTestClient(`http://127.0.0.1:${server.address().port}`, 'synthetic-epoch-test');
  try { await client.call('initialize'); await work(client, state, () => release?.()); }
  finally { await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const program = { body: { type: 'style', color: '#123456', durationMs: 100 } };
it('rejects a fenced old RPC before session creation, without implicit reconnect', async () => {
  await fixture(async (client, state) => {
    const result = await client.tool('express', { ...program, expectedEpoch: 'old' });
    expect(result.isError).toBe(true); expect(result.content[0].text).toContain('expected_epoch_mismatch');
    expect(state.creates).toBe(0); expect(state.posts).toHaveLength(0);
  });
});
it('rejects delayed old epoch after cancel and strips the valid host fence before HTTP dispatch', async () => {
  await fixture(async (client, state) => {
    const old = toolValue(await client.tool('cancel_expression')).epoch;
    const fresh = toolValue(await client.tool('cancel_expression')).epoch;
    const stale = await client.tool('express', { ...program, expectedEpoch: old });
    expect(stale.isError).toBe(true); expect(stale.content[0].text).toContain('expected_epoch_mismatch');
    expect(state.posts).toHaveLength(0);
    expect(toolValue(await client.tool('express', { ...program, expectedEpoch: fresh })).status).toBe('accepted');
    expect(state.posts).toHaveLength(1); expect(state.posts[0].epoch).toBe(fresh);
    expect(state.posts[0]).not.toHaveProperty('expectedEpoch');
  });
});
it('rechecks the host fence after awaiting feedback subscription, before any expression POST', async () => {
  await fixture(async (client, state, release) => {
    const epoch = toolValue(await client.tool('cancel_expression')).epoch;
    const pending = client.tool('express', { ...program, expectedEpoch: epoch });
    await state.events;
    expect((await client.tool('observe')).isError).toBe(true); release();
    const stale = await pending;
    expect(stale.isError).toBe(true); expect(stale.content[0].text).toContain('expected_epoch_mismatch');
    expect(state.posts).toHaveLength(0);
  }, true);
});

it('rejects a stale host before it interrupts an active playground owner', async () => {
  await fixture(async (client, state) => {
    const editing = client.tool('playground_edit', { operation: 'create', expectedRevision: 0, scene: {
      parts: [{ id: 'part', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.2, 0.3, 0.1] }],
      style: { color: '#123456', brightness: 0.8, pointSize: 1, dispersion: 0.1 },
      flow: { field: 'pulse', strength: 0.1 },
    } });
    await state.posted;
    const stale = await client.tool('express', { ...program, expectedEpoch: 'revoked' });
    expect(stale.isError).toBe(true); expect(stale.content[0].text).toContain('expected_epoch_mismatch');
    expect(state.cancels).toBe(0);
    state.releasePost();
    expect(toolValue(await editing)).toMatchObject({ status: 'committed', revision: 1 });
    expect(state.cancels).toBe(0);
  }, false, true);
});
