import { expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { LiveRequests, openCodexTransport } from '../integrations/live-codex-transport.mjs';
import { LiveOutput } from '../integrations/live-output.mjs';
import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';

const params = () => ({ threadId: 'selected', input: [{ type: 'text', text: 'Public synthetic user input', text_elements: [] }] });

it('guards and clones an owned request again at the actual write boundary', async () => {
  const writes = [], discarded = [], rpc = new LiveRequests(value => writes.push(value));
  let queued, current = true; const input = params();
  const result = rpc.request('turn/start', input, { guard: () => current, dispatch: value => { queued = value; }, discard: id => discarded.push(id) });
  const rejected = expect(result).rejects.toMatchObject({ uncertain: false });
  input.threadId = 'different'; current = false;
  expect(() => rpc.forward(queued)).toThrow(); await rejected;
  expect(writes).toEqual([]); expect(discarded).toEqual([queued.id]);
  expect(rpc.rejectOwned(queued, { message: 'late rejection' })).toBe(true); rpc.close();
});
it('preserves the captured parameters and suppresses duplicate forwarding', async () => {
  const writes = [], rpc = new LiveRequests(value => writes.push(value)); let queued;
  const input = params(), result = rpc.request('turn/start', input, { guard: () => true, dispatch: value => { queued = value; } });
  input.threadId = 'different'; rpc.forward(queued);
  const rejected = expect(result).rejects.toMatchObject({ uncertain: true });
  expect(() => rpc.forward(queued)).toThrow(); await rejected;
  expect(writes).toHaveLength(1); expect(writes[0].params.threadId).toBe('selected'); rpc.close();
});
it('never observes or accepts an owned ACK before the queued command was written', async () => {
  const writes = [], observed = [], rpc = new LiveRequests(value => writes.push(value)); let queued, resolved = false;
  try {
    const result = rpc.request('turn/start', params(), { guard: () => true, observe: value => observed.push(value), dispatch: value => { queued = value; } });
    void result.then(() => { resolved = true; }, () => {});
    const early = { id: queued.id, result: { turn: { id: 'never-sent', status: 'inProgress' } } };
    await rpc.observe(early); expect(rpc.accept(early)).toBe(false); await Promise.resolve();
    expect(observed).toEqual([]); expect(resolved).toBe(false); expect(writes).toEqual([]); expect(rpc.pending.size).toBe(1);
    rpc.forward(queued);
    const actual = { id: queued.id, result: { turn: { id: 'written', status: 'inProgress' } } };
    await rpc.observe(actual); expect(rpc.accept(actual)).toBe(false); expect(await result).toEqual(actual);
    expect(observed).toEqual([actual]); expect(writes).toHaveLength(1);
  } finally { rpc.close(); }
});
it('distinguishes a queued timeout from a sent timeout without retry or late resurrection', async () => {
  vi.useFakeTimers();
  const writes = [], observed = [], rpc = new LiveRequests(value => writes.push(value)); let queued;
  try {
    const unsent = rpc.request('turn/start', params(), { guard: () => true, dispatch: value => { queued = value; } });
    const sent = rpc.request('turn/start', params(), { guard: () => true, observe: value => observed.push(value) });
    const pending = [expect(unsent).rejects.toMatchObject({ uncertain: false }), expect(sent).rejects.toMatchObject({ uncertain: true })];
    await vi.advanceTimersByTimeAsync(10001); await Promise.all(pending);
    expect(() => rpc.forward(queued)).toThrow(); expect(writes).toHaveLength(1);
    const late = { id: writes[0].id, result: { turn: { id: 'late', status: 'inProgress' } } };
    await rpc.observe(late); expect(rpc.accept(late)).toBe(false); expect(observed).toEqual([]);
  } finally { rpc.close(); vi.useRealTimers(); }
});
it('treats a thrown write attempt as unknown and never exposes raw errors', async () => {
  let writes = 0; const rpc = new LiveRequests(() => { writes++; throw Error('synthetic secret error'); });
  await expect(rpc.request('turn/start', params(), { guard: () => true })).rejects.toMatchObject({ uncertain: true, message: 'relay_write_unknown' });
  expect(writes).toBe(1); rpc.close();
});
it('does not write an expired queue item before its timeout callback gets CPU time', async () => {
  let now = 0, queued; const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const writes = [], rpc = new LiveRequests(value => writes.push(value));
  try {
    const result = rpc.request('turn/start', params(), { guard: () => true, dispatch: value => { queued = value; } });
    const failure = result.catch(error => error); now = 10001;
    expect(() => rpc.forward(queued)).toThrow(); expect(await failure).toMatchObject({ uncertain: false }); expect(writes).toEqual([]);
  } finally { rpc.close(); clock.mockRestore(); }
});
it('keeps close uncertainty and capacity bounded for owned requests', async () => {
  const rpc = new LiveRequests(() => {}), pending = [];
  for (let i = 0; i < 8; i++) pending.push(rpc.request('turn/start', params(), { guard: () => true }));
  await expect(rpc.request('turn/start', params(), { guard: () => true })).rejects.toMatchObject({ message: 'relay_request_limit', uncertain: false });
  const failures = pending.map(value => expect(value).rejects.toMatchObject({ uncertain: true }));
  rpc.close(); await Promise.all(failures); expect(rpc.pending.size).toBe(0);
});
it('does not observe an expired ACK before its timeout callback runs', async () => {
  let now = 0; const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const writes = [], observed = [], rpc = new LiveRequests(value => writes.push(value));
  try {
    const result = rpc.request('turn/start', params(), { guard: () => true, observe: value => observed.push(value) });
    const failure = result.catch(error => error); now = 10001;
    const late = { id: writes[0].id, result: { turn: { id: 'late', status: 'inProgress' } } };
    await rpc.observe(late); expect(observed).toEqual([]); expect(rpc.accept(late)).toBe(false);
    expect(await failure).toMatchObject({ uncertain: true });
  } finally { rpc.close(); clock.mockRestore(); }
});

async function fixture() {
  const output = new LiveOutput(), observed = [], native = [], writes = []; let transport, barrier = async () => {};
  const page = { evaluate: async () => barrier() };
  const broker = new LiveReactiveBroker({ page, provider: null, output,
    forward: message => { writes.push(message.method); transport.forward(message); }, reject: (message, error) => transport.reject(message, error) });
  transport = await openCodexTransport({ host: { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/owned-chat-agent.mjs', import.meta.url))] },
    args: [], cwd: process.cwd(), env: process.env, instructions: '',
    onRequest: message => { output.request(message); return broker.client(message); },
    onEvent: async message => { await output.accept(message); broker.event(message); observed.push(message); } });
  const socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } });
  socket.on('message', bytes => native.push(JSON.parse(bytes.toString()))); socket.on('error', () => {});
  const close = async () => { broker.close(); socket.terminate(); await transport.close(); };
  const discard = id => { output.turnRequests.delete(id); broker.pending.delete(id); };
  try {
    await once(socket, 'open'); socket.send(JSON.stringify({ id: 1, method: 'thread/start', params: {} }));
    await vi.waitFor(() => expect(output.thread).toBe('selected'));
    return { output, broker, transport, observed, native, writes, socket, discard, barrier: callback => { barrier = callback; }, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
it('rejects a false, throwing or missing guard before admitting browser input', async () => {
  const f = await fixture();
  try {
    await expect(f.transport.submitUser(params(), () => false, f.discard)).rejects.toMatchObject({ uncertain: false, message: 'relay_guard_rejected' });
    await expect(f.transport.interruptUser({ threadId: 'selected', turnId: 'wrong' }, () => { throw Error('synthetic private guard'); }, f.discard))
      .rejects.toMatchObject({ uncertain: false, message: 'relay_guard_rejected' });
    await expect(f.transport.submitUser(params())).rejects.toMatchObject({ uncertain: false, message: 'relay_guard_required' });
    expect(f.broker.pending.size).toBe(0); expect(f.output.turnRequests.size).toBe(0);
    expect(f.writes).toEqual(['thread/start']);
  } finally { await f.close(); }
});
it('observes an ACK-only owned turn before resolving, preserves Native notifications, and guards interrupt', async () => {
  const f = await fixture();
  try {
    const ack = await f.transport.submitUser(params(), () => f.output.thread === 'selected' && f.output.selection === undefined, f.discard);
    expect(ack.result.turn).toEqual({ id: 'owned-turn', status: 'inProgress' });
    expect(f.output.turn).toBe('owned-turn'); expect(f.broker.turns.has('owned-turn')).toBe(true);
    await vi.waitFor(() => expect(f.native.some(value => value.method === 'item/agentMessage/delta')).toBe(true));
    expect(f.native.some(value => value.id === ack.id)).toBe(false);
    expect(f.observed.filter(value => value.id === ack.id)).toHaveLength(1);
    const interrupted = await f.transport.interruptUser({ threadId: 'selected', turnId: 'owned-turn' }, () => f.output.turn === 'owned-turn', f.discard);
    expect(interrupted.error).toBeUndefined();
    await vi.waitFor(() => expect(f.output.turn).toBeUndefined());
    expect(f.writes).toEqual(['thread/start', 'turn/start', 'turn/interrupt']);
  } finally { await f.close(); }
});
it('rejects a queued browser send when Native starts a thread before the shared barrier releases', async () => {
  const f = await fixture(); let release;
  try {
    f.barrier(() => new Promise(resolve => { release = resolve; }));
    const revision = f.output.revision;
    const result = f.transport.submitUser(params(), () => f.output.revision === revision && f.output.selection === undefined, f.discard);
    const rejected = expect(result).rejects.toMatchObject({ uncertain: false });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.socket.send(JSON.stringify({ id: 2, method: 'thread/start', params: {} }));
    await vi.waitFor(() => expect(f.output.selection).toBe(2)); f.barrier(async () => {}); release(); await rejected;
    await vi.waitFor(() => expect(f.native.some(value => value.id === 2)).toBe(true));
    f.socket.send(JSON.stringify({ id: 3, method: 'test/snapshot', params: {} }));
    await vi.waitFor(() => expect(f.native.some(value => value.id === 3)).toBe(true));
    expect(f.native.find(value => value.id === 3).result.methods).not.toContain('turn/start');
    expect(f.broker.pending.size).toBe(0);
  } finally { release?.(); await f.close(); }
});
it('rejects a Native ID collision before it can overwrite a queued owned turn', async () => {
  const f = await fixture(); let release, ownedId;
  try {
    f.barrier(() => new Promise(resolve => { release = resolve; }));
    const sent = f.transport.submitUser(params(), message => { ownedId = message.id; return true; }, f.discard);
    const outcome = sent.catch(error => error);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.socket.send(JSON.stringify({ id: ownedId, method: 'turn/start', params: { threadId: 'other', input: [] } }));
    await vi.waitFor(() => expect(f.native.find(value => value.id === ownedId)?.error?.message).toBe('relay_request_id_reserved'));
    expect(f.output.turnRequests.get(ownedId)?.threadId).toBe('selected'); expect(f.broker.pending.size).toBe(1);
    f.barrier(async () => {}); release(); expect((await outcome).result.turn.id).toBe('owned-turn');
    expect(f.output.turn).toBe('owned-turn'); expect(f.broker.turns.has('owned-turn')).toBe(true);
  } finally { release?.(); await f.close(); }
});
it('reserves future private IDs before any owned reservation exists', async () => {
  const f = await fixture(); let prior;
  try {
    await expect(f.transport.submitUser(params(), message => { prior = message.id; return false; }, f.discard)).rejects.toMatchObject({ uncertain: false });
    const split = prior.lastIndexOf(':'), next = prior.slice(0, split + 1) + (Number(prior.slice(split + 1)) + 1);
    f.socket.send(JSON.stringify({ id: next, method: 'turn/start', params: params() }));
    await vi.waitFor(() => expect(f.native.find(value => value.id === next)?.error?.message).toBe('relay_request_id_reserved'));
    expect(f.output.turnRequests.size).toBe(0); expect(f.broker.pending.size).toBe(0);
    f.socket.send(JSON.stringify({ id: next, result: { decision: 'accept' } }));
    f.socket.send(JSON.stringify({ id: 77, method: 'test/snapshot', params: {} }));
    await vi.waitFor(() => expect(f.native.some(value => value.id === 77)).toBe(true));
    expect(f.native.find(value => value.id === 77).result.methods).toContain(null);
    const ack = await f.transport.submitUser(params(), () => true, f.discard);
    expect(ack.id).toBe(next); expect(f.output.turn).toBe('owned-turn'); expect(f.broker.turns.has('owned-turn')).toBe(true);
  } finally { await f.close(); }
});
