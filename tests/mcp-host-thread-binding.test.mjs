import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';

const metadata = threadId => ({ threadId, sessionId: 'shared-root-and-descendants' });
const command = { body: { type: 'style', color: '#37a9ce', durationMs: 100 } };
const uri = 'aer://controller-binding/v1';
const invoke = (client, name, args, meta) => client.call('tools/call', { name, arguments: args, ...(meta === undefined ? {} : { _meta: meta }) });
const rejected = (value, code) => { expect(value.isError).toBe(true); expect(JSON.parse(value.content[0].text)).toEqual({ status: 'rejected', code }); };
const binding = async client => JSON.parse((await client.call('resources/read', { uri })).contents[0].text);

async function fixture(work, { strict = true, validToken = true } = {}) {
  const state = { creates: 0, expressions: [], cancels: 0, requests: [], epoch: 'epoch-1', streams: new Set() };
  const server = createServer(async (request, response) => {
    state.requests.push(request.url);
    if (request.headers.authorization !== 'Bearer synthetic-thread-pairing') { response.writeHead(401, { 'Content-Type': 'application/json' }).end('{"code":"unauthorized"}'); return; }
    if (request.url.endsWith('/events')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(': ready\n\n');
      state.streams.add(response); response.on('close', () => state.streams.delete(response)); return;
    }
    let text = ''; for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : {}; let result = {};
    if (request.url === '/v1/sessions') { state.creates++; result = { id: 'controller-1', epoch: state.epoch }; }
    else if (request.url.endsWith('/cancel')) { state.cancels++; state.epoch = 'epoch-' + (state.cancels + 1); result = { id: 'controller-1', epoch: state.epoch, status: 'cancelled' }; }
    else if (request.url.endsWith('/expressions')) { state.expressions.push(body); result = { session: 'controller-1', epoch: state.epoch, seq: state.expressions.length, status: 'accepted' }; }
    response.writeHead(request.method === 'DELETE' ? 204 : 200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = liveTestClient(`http://127.0.0.1:${server.address().port}`, validToken ? 'synthetic-thread-pairing' : 'invalid-token', { env: { FISCH_MCP_REQUIRE_THREAD: strict ? '1' : undefined } });
  try { await work(client, state); }
  finally { await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

it('requires explicit host-thread binding before tools without connecting or trusting model arguments', async () => {
  await fixture(async (client, state) => {
    const initialized = await client.call('initialize'); expect(initialized.instructions).toContain('call bind_controller');
    expect((await client.call('tools/list')).tools.map(value => value.name)).toContain('bind_controller');
    expect((await client.call('resources/list')).resources.map(value => value.uri)).toContain(uri);
    expect(await binding(client)).toEqual({ schemaVersion: 1, status: 'unbound', scope: 'mcp_host_thread', authority: 'routing_context_not_authentication' });
    rejected(await invoke(client, 'express', command), 'host_thread_required');
    rejected(await invoke(client, 'express', { ...command, _meta: metadata('thread-a') }), 'host_thread_required');
    rejected(await invoke(client, 'observe', {}, { sessionId: 'shared-root-and-descendants' }), 'host_thread_required');
    rejected(await invoke(client, 'observe', {}, metadata('thread-a')), 'controller_unbound');
    rejected(await invoke(client, 'bind_controller', { threadId: 'thread-b' }, metadata('thread-a')), 'binding_arguments');
    rejected(await invoke(client, 'bind_controller', null, metadata('thread-a')), 'binding_arguments');
    expect((await binding(client)).status).toBe('unbound'); expect(state.requests).toEqual([]);
    expect(toolValue(await invoke(client, 'bind_controller', {}, metadata('thread-a')))).toMatchObject({ status: 'bound', scope: 'mcp_host_thread' });
    expect(JSON.stringify(await binding(client))).not.toContain('thread-a');
    expect(state.requests).toEqual([]);
  });
});

it('pins the thread across initialize, cancel and gateway epoch changes without accepting a sibling session label', async () => {
  await fixture(async (client, state) => {
    await client.call('initialize'); await invoke(client, 'bind_controller', {}, metadata('thread-a'));
    const result = toolValue(await invoke(client, 'express', command, metadata('thread-a')));
    expect(result).toMatchObject({ session: 'controller-1', epoch: 'epoch-1', seq: 1 });
    expect(state.creates).toBe(1); expect(state.expressions).toHaveLength(1);
    const requests = state.requests.length;
    for (const name of ['express', 'cancel_expression', 'expression_status', 'observe', 'playground_state', 'compose_expression', 'bind_controller'])
      rejected(await invoke(client, name, {}, metadata('thread-b')), 'host_thread_mismatch');
    rejected(await invoke(client, 'cancel_expression', {}), 'host_thread_required');
    expect(state.requests.length).toBe(requests); expect(state.cancels).toBe(0);
    expect(toolValue(await invoke(client, 'cancel_expression', {}, metadata('thread-a'))).epoch).toBe('epoch-2');
    await client.call('initialize');
    expect(toolValue(await invoke(client, 'bind_controller', {}, metadata('thread-a'))).status).toBe('bound');
    rejected(await invoke(client, 'bind_controller', {}, metadata('thread-b')), 'host_thread_mismatch');
    expect(await binding(client)).toEqual({ schemaVersion: 1, status: 'bound', scope: 'mcp_host_thread', authority: 'routing_context_not_authentication' });
    expect(state.creates).toBe(1);
  });
});

it('rejects malformed host IDs before any side effect and validates before compose rewriting', async () => {
  await fixture(async (client, state) => {
    await client.call('initialize');
    for (const threadId of [null, 42, {}, '', 'x'.repeat(129), 'line\nbreak', 'not a thread'])
      rejected(await invoke(client, 'bind_controller', {}, metadata(threadId)), 'host_thread_invalid');
    await invoke(client, 'bind_controller', {}, metadata('thread-a'));
    rejected(await invoke(client, 'compose_expression', { invalid: true }, metadata('thread-b')), 'host_thread_mismatch');
    expect(state.requests).toEqual([]);
  });
});

it('keeps gateway authentication separate from a successful process-local routing bind', async () => {
  await fixture(async (client, state) => {
    await client.call('initialize');
    expect(toolValue(await invoke(client, 'bind_controller', {}, metadata('thread-a'))).authority).toBe('routing_context_not_authentication');
    rejected(await invoke(client, 'express', command, metadata('thread-a')), 'unauthorized');
    expect(state.creates).toBe(0); expect(state.expressions).toEqual([]);
  }, { validToken: false });
});

it('retains the legacy catalog, instruction bytes and metadata-free calls when the opt-in is absent', async () => {
  await fixture(async (client, state) => {
    const initialized = await client.call('initialize');
    expect(initialized.instructions).toBe(readFileSync(new URL('../integrations/live-instructions.md', import.meta.url), 'utf8'));
    expect((await client.call('tools/list')).tools.map(value => value.name)).not.toContain('bind_controller');
    expect((await client.call('resources/list')).resources.map(value => value.uri)).not.toContain(uri);
    expect(toolValue(await client.tool('express', command)).status).toBe('accepted'); expect(state.expressions).toHaveLength(1);
  }, { strict: false });
});
