import { expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { PanelProtocol, openPanelClient } from '../integrations/panel-client.mjs';

function fixture() {
  const writes = [], controls = [], client = new PanelProtocol({ write: value => writes.push(value), onControl: value => controls.push(value) });
  client.threadId = 'thread'; client.receive({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } });
  const request = (id = 1, method = 'item/commandExecution/requestApproval', extra = {}) => client.receive({ id, method,
    params: { threadId: 'thread', turnId: 'turn', itemId: 'item', command: 'echo public', cwd: '/public', startedAtMs: 0, ...extra } });
  return { writes, controls, client, request };
}
it('requires explicit one-time choice; preserves RPC id type and refuses broadened permissions', () => {
  const f = fixture(); f.request(0); expect(f.writes).toEqual([]);
  expect(f.controls[0].choices).toEqual(['accept', 'decline', 'cancel']);
  for (const decision of ['acceptForSession', { acceptWithExecpolicyAmendment: {} }, 'approve']) expect(() => f.client.respond({ id: 0, decision })).toThrow('panel_decision_invalid');
  expect(() => f.client.respond({ id: 0, decision: 'accept', extra: true })).toThrow();
  expect(f.client.respond({ id: 0, decision: 'accept' })).toEqual({ status: 'submitted' });
  expect(f.writes).toEqual([{ id: 0, result: { decision: 'accept' } }]);
  expect(f.controls.at(-1).reason).toBe('submitted'); expect(() => f.client.respond({ id: 0, decision: 'accept' })).toThrow('stale');
  f.request('0'); expect(f.client.controls.has('0')).toBe(true); f.client.close();
});
it('does not replay an approval after an uncertain response write', () => {
  const f = fixture(); f.request(1); f.client.write = () => { throw Error('transport lost'); };
  expect(() => f.client.respond({ id: 1, decision: 'accept' })).toThrow('panel_response_unknown');
  expect(f.controls.at(-1).reason).toBe('response_unknown');
  expect(f.client.closed).toBe(true); expect(() => f.client.respond({ id: 1, decision: 'accept' })).toThrow('unavailable'); f.client.close();
});
it('withholds accept for session-root grants, missing commands and unsupported command kinds', () => {
  const f = fixture();
  f.request(1, 'item/fileChange/requestApproval', { grantRoot: '/public' });
  f.request(2, undefined, { command: null }); f.request(3, undefined, { kind: 'writeStdin' }); f.request(4, undefined, { cwd: null });
  f.request(5, 'item/fileChange/requestApproval', { grantRoot: null });
  for (const id of [1, 2, 3, 4, 5]) {
    expect(f.client.controls.get(id).choices).toEqual(['decline', 'cancel']);
    expect(() => f.client.respond({ id, decision: 'accept' })).toThrow();
    f.client.respond({ id, decision: 'decline' });
  }
  f.client.receive({ method: 'item/started', params: { threadId: 'thread', turnId: 'turn', item: { id: 'item', type: 'fileChange', status: 'inProgress', changes: [{ path: '/public/file', diff: '+public', kind: { type: 'add' } }] } } });
  f.request(6, 'item/fileChange/requestApproval', { grantRoot: null });
  f.client.respond({ id: 6, decision: 'accept' }); expect(f.writes.at(-1).result).toEqual({ decision: 'accept' }); f.client.close();
});
it('validates bounded structured questions and answers without guessing or secret handling', () => {
  const f = fixture(), questions = [{ id: 'q', header: 'Choice', question: 'Which?', options: [{ label: 'A', description: 'Public option' }] }];
  f.request(1, 'item/tool/requestUserInput', { isBlocking: true, questions });
  expect(f.writes).toHaveLength(0);
  for (const answers of [{}, { q: { answers: [1] } }, { q: { answers: ['A'] }, unknown: { answers: ['B'] } }]) expect(() => f.client.respond({ id: 1, answers })).toThrow();
  f.client.respond({ id: 1, answers: { q: { answers: ['A'] } } });
  expect(f.writes[0]).toEqual({ id: 1, result: { answers: { q: { answers: ['A'] } } } });
  f.request(2, 'item/tool/requestUserInput', { isBlocking: true, questions: [{ ...questions[0], isSecret: true }] });
  expect(f.writes.at(-1).error.code).toBe(-32601); expect(f.controls.at(-1).type).toBe('unsupported'); f.client.close();
});
it('keeps sixteen requests bounded, rejects unknown/cross-owner/oversized requests without approval', () => {
  const f = fixture(); for (let id = 0; id < 16; id++) f.request(id);
  f.request(16); f.request(17, 'other/requestApproval'); f.request(18, undefined, { threadId: 'other' });
  f.request(19, undefined, { turnId: 'other' }); f.request(20, undefined, { reason: 'x'.repeat(17000) });
  expect(f.client.controls.size).toBe(16); expect(f.writes).toHaveLength(5);
  expect(f.writes.every(value => value.error?.code === -32601 && !value.result)).toBe(true); f.client.close();
});
it('revokes controls on terminal/new owner/resolution, ignores foreign resolution and duplicate start', () => {
  const f = fixture(); f.request(1);
  f.client.receive({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } });
  f.client.receive({ method: 'serverRequest/resolved', params: { threadId: 'foreign', requestId: 1 } });
  expect(f.client.controls.size).toBe(1);
  f.client.receive({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 1 } });
  expect(() => f.client.respond({ id: 1, decision: 'accept' })).toThrow('stale'); f.request(2);
  f.client.receive({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
  expect(f.client.controls.size).toBe(0); expect(f.controls.at(-1).reason).toBe('turn_terminal');
  f.client.receive({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } });
  expect(f.client.turnId).toBeUndefined();
  f.client.receive({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'new' } } });
  f.request(3, undefined, { turnId: 'new' });
  f.client.receive({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'next' } } });
  expect(() => f.client.respond({ id: 3, decision: 'accept' })).toThrow('stale');
  expect(() => f.request(1)).toThrow('duplicate'); f.client.close();
});
it('refuses incomplete, oversized or foreign-owner file details as approval evidence', () => {
  const f = fixture(), item = { id: 'item', type: 'fileChange', changes: [{ path: '/public/file', kind: { type: 'add' } }] };
  for (const [id, turnId, value] of [[1, 'turn', item], [2, 'foreign', { ...item, changes: [{ ...item.changes[0], diff: '+public' }] }], [3, 'turn', { ...item, changes: [{ ...item.changes[0], diff: 'x'.repeat(17000) }] }]]) {
    f.client.receive({ method: 'item/started', params: { threadId: 'thread', turnId, item: value } });
    f.request(id, 'item/fileChange/requestApproval', { grantRoot: null });
    expect(() => f.client.respond({ id, decision: 'accept' })).toThrow('invalid');
  }
  f.client.close();
});
it('retains bounded RPC errors for internal startup diagnosis, without projecting them', async () => {
  const f = fixture(), job = f.client.request('thread/start', {}), rpcError = { code: -32000, message: 'fixture startup cause', data: { fixture: true } };
  f.client.receive({ id: f.writes[0].id, error: rpcError });
  await expect(job).rejects.toMatchObject({ message: 'panel_rpc_rejected', rpcError }); expect(f.controls).toEqual([]); f.client.close();
});
it('projects actual bounded tool lifecycle without interpreting completion as success', () => {
  const f = fixture();
  for (const [method, status] of [['item/started', 'inProgress'], ['item/completed', 'failed']]) f.client.receive({ method,
    params: { threadId: 'thread', turnId: 'turn', item: { id: 'item', type: 'mcpToolCall', server: 'fisch_live', tool: 'compose_expression', status } } });
  expect(f.controls.map(c => [c.phase, c.item.status])).toEqual([['started', 'inProgress'], ['completed', 'failed']]);
  f.client.receive({ method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item: { id: 'large', type: 'commandExecution', status: 'completed', aggregatedOutput: 'x'.repeat(17000) } } });
  expect(f.controls.at(-1).item).toEqual({ id: 'large', type: 'commandExecution', status: 'completed', truncated: true }); f.client.close();
});
it('bounds outbound RPC, settles on close, and never retains a prewrite failure', async () => {
  const f = fixture(), jobs = Array.from({ length: 8 }, () => f.client.request('test', {}));
  await expect(f.client.request('test', {})).rejects.toThrow('unavailable');
  f.client.close(); expect((await Promise.allSettled(jobs)).every(result => result.status === 'rejected')).toBe(true);
  const broken = new PanelProtocol({ write() { throw Error('private'); } });
  await expect(broken.request('test', {})).rejects.toThrow('panel_write_unknown'); expect(broken.pending.size).toBe(0); broken.close();
});
it('resumes only an explicitly selected matching thread and rejects invalid identity without dispatch', async () => {
  const messages = [], client = new PanelProtocol({ write: message => {
    messages.push(message);
    if (message.id) queueMicrotask(() => client.receive({ id: message.id, result: message.method === 'initialize' ? {} : { thread: { id: 'selected' } } }));
  } });
  await expect(client.initialize('/public', '')).rejects.toThrow('panel_resume_invalid'); expect(messages).toEqual([]);
  expect(await client.initialize('/public', 'selected')).toBe('selected');
  expect(messages.at(-1)).toMatchObject({ method: 'thread/resume', params: { threadId: 'selected', cwd: '/public' } });
  await expect(client.initialize('/public', 'other')).rejects.toThrow('panel_thread_invalid'); client.close();
});
it('authenticates a real loopback WS and completes handshake/thread selection without starting inference', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const messages = [], events = [], failures = []; let peer;
  server.on('connection', (socket, req) => {
    peer = socket; expect(req.headers.authorization).toBe('Bearer private-test-token');
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString()); messages.push(message);
      if (message.method === 'initialize') socket.send(JSON.stringify({ id: message.id, result: { userAgent: 'fixture' } }));
      if (message.method === 'thread/start') socket.send(JSON.stringify({ id: message.id, result: { thread: { id: 'thread' } } }));
    });
  });
  const client = await openPanelClient({ url: `ws://127.0.0.1:${server.address().port}`, token: 'private-test-token', cwd: '/public', onControl: e => events.push(e), onFailure: e => failures.push(e) });
  expect(client.threadId).toBe('thread'); expect(messages.map(m => m.method)).toEqual(['initialize', 'initialized', 'thread/start']);
  expect(messages[2].params).toEqual({ cwd: '/public' });
  peer.send(JSON.stringify({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } }));
  peer.send(JSON.stringify({ id: 5, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'turn', itemId: 'item', command: 'echo public', startedAtMs: 0 } }));
  await new Promise(resolve => setTimeout(resolve, 25)); expect(events[0].type).toBe('request');
  client.respond({ id: 5, decision: 'decline' }); client.close();
  await new Promise(resolve => server.close(resolve)); expect(failures).toEqual([]);
});
