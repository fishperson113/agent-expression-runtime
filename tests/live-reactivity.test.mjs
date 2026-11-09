import { expect, it, vi } from 'vitest';
import { LiveReactivity } from '../integrations/live-reactivity.mjs';
import { LiveRequests } from '../integrations/live-codex-transport.mjs';

function fixture() {
  let now = 100000;
  const sent = [], forwarded = [], logs = [], replies = [];
  const output = { thread: 't', state: 'idle', turn: undefined };
  const controller = new LiveReactivity({ output, now: () => now, forward: message => forwarded.push(message),
    log: text => logs.push(text), request: (method, params) => {
      sent.push({ method, params }); return new Promise(resolve => replies.push(resolve));
    } });
  const sample = (events = [], extra = {}) => controller.sample({
    sessionId: 's', enabled: true, stopped: false, camera: 'tracking', capturedAt: now, events, ...extra });
  const event = (type, seq) => ({ type, seq, at: now });
  const advance = ms => { now += ms; };
  return { controller, output, sent, forwarded, logs, replies, sample, event, advance };
}
async function launch(f) {
  await f.sample(); const event = f.event('user_arrived', 1);
  await f.sample([event]); f.advance(750); await f.sample([event]); return event;
}
const complete = (f, id = 'r') => f.controller.event({ method: 'turn/completed', params: { threadId: 't', turn: { id, status: 'completed' } } });
const settle = async (f, id = 'r') => { f.replies.shift()({ result: { turn: { id, status: 'inProgress' } } }); await Promise.resolve(); };

it('only sends debounced fresh typed camera events once, never frames or fake user input', async () => {
  const f = fixture(), event = await launch(f);
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0].params.input).toEqual([]);
  expect(f.sent[0].params.toolOutput.name).toBe('fisch_local_observation');
  expect(f.sent[0].params.toolOutput.output).toContain('user_arrived');
  await settle(f); complete(f); f.advance(20000); await f.sample([event]);
  expect(f.sent).toHaveLength(1);
});
it('coalesces opposing cues and ignores mouth/turn recursion', async () => {
  const f = fixture(); await f.sample();
  await f.sample([f.event('user_arrived', 1), f.event('user_left', 2), f.event('turn_changed', 3), f.event('mouth_started', 4)]);
  f.advance(750); await f.sample();
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0].params.toolOutput.output).toContain('user_left');
  expect(f.sent[0].params.toolOutput.output).not.toContain('user_arrived');
});
it('does not replay events on enable, camera failure, reload, or stale snapshots', async () => {
  const f = fixture(), event = f.event('user_arrived', 1);
  await f.sample([event]); f.advance(1000); await f.sample([event]);
  expect(f.sent).toHaveLength(0);
  await f.sample([f.event('looked_away', 2)]); await f.sample([], { camera: 'stopped' });
  f.advance(1000); await f.sample(); expect(f.sent).toHaveLength(0);
  await f.sample([f.event('looked_back', 3)]); await f.sample([], { sessionId: 'new' });
  f.advance(1000); await f.sample([], { sessionId: 'new' }); expect(f.sent).toHaveLength(0);
  await f.sample([f.event('looked_away', 4)], { sessionId: 'new', capturedAt: 0 });
  f.advance(1000); await f.sample([], { sessionId: 'new' }); expect(f.sent).toHaveLength(0);
});
it('never starts or interrupts an ordinary user turn, including request-before-notification', async () => {
  const f = fixture(); await f.sample();
  f.controller.client({ id: 1, method: 'turn/start', params: { threadId: 't', input: [] } });
  f.controller.event({ id: 1, result: { turn: { id: 'u' } } });
  await f.sample([f.event('user_arrived', 1)]); f.advance(800); await f.sample();
  expect(f.sent).toEqual([]);
  f.output.turn = 'u'; f.output.state = 'working';
  await f.sample([], { enabled: false }); expect(f.sent).toEqual([]);
});
it('prioritizes user starts without losing args and interrupts only its owned turn', async () => {
  const f = fixture(); await launch(f);
  const user = { id: 42, method: 'turn/start', params: { threadId: 't', input: [{ type: 'text', text: 'private' }], model: 'unchanged' } };
  expect(f.controller.client(user)).toBe(false); expect(f.forwarded).toEqual([]);
  await settle(f);
  expect(f.sent[1]).toEqual({ method: 'turn/interrupt', params: { threadId: 't', turnId: 'r' } });
  f.replies.shift()({ result: {} }); await Promise.resolve();
  expect(f.forwarded).toEqual([]);
  complete(f); expect(f.forwarded).toEqual([user]);
  expect(f.logs.join(' ')).not.toContain('private');
});
it('handles completion before start response without resurrecting a finished reaction', async () => {
  const f = fixture(); await launch(f);
  f.controller.event({ method: 'turn/started', params: { threadId: 't', turn: { id: 'r' } } });
  complete(f); await settle(f);
  expect(f.controller.active).toBeUndefined();
});
it('disabling stops only the reaction and drops pending work', async () => {
  const f = fixture(); await launch(f); await settle(f);
  await f.sample([], { enabled: false });
  expect(f.sent[1].method).toBe('turn/interrupt');
  complete(f); await f.sample([f.event('user_left', 2)], { enabled: false });
  f.advance(20000); await f.sample([f.event('user_left', 2)]);
  expect(f.sent).toHaveLength(2);
});
it('bounds rates and expires events instead of replaying them after a long user turn', async () => {
  const f = fixture(); await launch(f); await settle(f); complete(f);
  f.advance(1000); await f.sample([f.event('looked_away', 2)]); f.advance(750); await f.sample();
  expect(f.sent).toHaveLength(1);
  f.advance(15000); await f.sample(); expect(f.sent).toHaveLength(1);
  await f.sample([f.event('looked_back', 3)]); f.advance(750); await f.sample();
  expect(f.sent).toHaveLength(2);
});
it('clears rejected requests and never retries an uncertain response automatically', async () => {
  const f = fixture(); await launch(f); f.replies.shift()({ error: { code: -1 } }); await Promise.resolve();
  expect(f.controller.active).toBeUndefined();
  f.advance(16000); await f.sample([f.event('user_left', 2)]); f.advance(750); await f.sample();
  f.replies.shift()({ result: {} }); await Promise.resolve();
  f.advance(16000); await f.sample([f.event('user_arrived', 3)]); f.advance(750); await f.sample();
  expect(f.sent).toHaveLength(2);
});
it('close prevents new work and clears bounded user queues', async () => {
  const f = fixture(); await launch(f);
  f.controller.client({ id: 1, method: 'turn/start', params: { threadId: 't' } });
  f.controller.close(); await settle(f);
  expect(f.forwarded).toEqual([]); expect(f.controller.queued).toEqual([]);
  f.advance(20000); await f.sample([f.event('user_left', 2)]); expect(f.sent).toHaveLength(1);
});
it('multiplexes private requests, preserves colliding client IDs and server approvals', async () => {
  const written = [], rpc = new LiveRequests(message => written.push(message));
  const response = rpc.request('turn/start', { threadId: 't' }), internal = written[0].id;
  rpc.client({ id: internal, method: 'thread/read', params: {} });
  const clientId = written[1].id;
  expect(clientId).not.toBe(internal);
  expect(rpc.accept({ id: internal, result: { turn: { id: 'r' } } })).toBe(false);
  expect((await response).result.turn.id).toBe('r');
  expect(rpc.accept({ id: clientId, result: {} }).id).toBe(internal);
  const approval = { id: internal, method: 'item/commandExecution/requestApproval', params: {} };
  expect(rpc.accept(approval)).toBe(approval); rpc.close();
});
it('times out bounded RPC slots and hides late responses from the CLI', async () => {
  vi.useFakeTimers();
  try {
    const written = [], rpc = new LiveRequests(message => written.push(message));
    const promise = rpc.request('turn/start', {});
    const rejected = expect(promise).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(10000); await rejected;
    expect(rpc.pending.size).toBe(0); expect(rpc.accept({ id: written[0].id, result: {} })).toBe(false);
    rpc.close();
  } finally { vi.useRealTimers(); }
});


it('session invalidation cancels an owned pending turn when its delayed response arrives', async () => {
  const f = fixture(); await launch(f);
  await f.sample([], { sessionId: 'cancelled' }); await settle(f);
  expect(f.sent[1]).toEqual({ method: 'turn/interrupt', params: { threadId: 't', turnId: 'r' } });
});
it('camera stop revokes a running reaction and consumes its old event baseline', async () => {
  const f = fixture(); await launch(f); await settle(f);
  const event = f.event('looked_away', 2);
  await f.sample([event], { camera: 'stopped' });
  expect(f.sent[1].method).toBe('turn/interrupt'); complete(f);
  f.advance(16000); await f.sample([event]); f.advance(750); await f.sample([event]);
  expect(f.sent).toHaveLength(2);
});
it('bounds cancellation waiting and explicitly rejects user input rather than silently losing it', async () => {
  const f = fixture(), rejected = []; f.controller.reject = (message, error) => rejected.push({ message, error });
  await launch(f); await settle(f);
  const user = { id: 5, method: 'turn/start', params: { threadId: 't', input: [] } };
  f.controller.client(user); f.advance(10000); await f.sample();
  expect(f.forwarded).toEqual([]); expect(rejected[0].message).toBe(user);
  expect(rejected[0].error.message).toContain('not sent'); expect(f.controller.queued).toEqual([]);
});
it('uses only fixed activity labels, never tool arguments, raw output, or model thoughts', () => {
  const f = fixture();
  for (const method of ['item/started', 'item/completed']) f.controller.event({
    method, params: { threadId: 't', item: { type: 'mcpToolCall', arguments: 'SECRET', result: 'SECRET' } } });
  f.controller.event({ method: 'item/reasoning/textDelta', params: { threadId: 't', delta: 'SECRET' } });
  expect(f.logs).toEqual(['Codex tool call started.', 'Codex tool call finished.']);
});
it('never exceeds four starts in a rolling minute even under continuous fresh events', async () => {
  const f = fixture(); await f.sample();
  let seq = 0;
  for (let index = 0; index < 60; index++) {
    await f.sample([f.event('expression_changed', ++seq)]); f.advance(750); await f.sample();
    if (f.controller.starting) { await settle(f, 'r' + index); complete(f, 'r' + index); }
    f.advance(250);
  }
  expect(f.sent.filter(message => message.method === 'turn/start')).toHaveLength(4);
});
it('bounds private RPC requests and rejects all pending work on transport close', async () => {
  const rpc = new LiveRequests(() => {});
  const pending = Array.from({ length: 8 }, () => rpc.request('test', {}).catch(error => error.message));
  await expect(rpc.request('test', {})).rejects.toThrow('limit');
  rpc.close(); expect(await Promise.all(pending)).toEqual(Array(8).fill('relay_closed'));
});


it('holds reactions while thread selection is awaiting its reply', async () => {
  const f = fixture(); await f.sample();
  f.controller.client({ id: 22, method: 'thread/resume', params: { threadId: 'next' } });
  await f.sample(); await f.sample([f.event('user_arrived', 1)]); f.advance(750); await f.sample();
  expect(f.sent).toEqual([]);
  f.controller.event({ id: 22, error: { code: -1 } });
  await f.sample(); expect(f.sent).toHaveLength(1);
});
it('does not retain a user turn whose completion preceded its request reply', async () => {
  const f = fixture(); await f.sample();
  f.controller.client({ id: 11, method: 'turn/start', params: { threadId: 't' } });
  complete(f, 'u');
  f.controller.event({ id: 11, result: { turn: { id: 'u', status: 'inProgress' } } });
  await f.sample([f.event('user_arrived', 1)]); f.advance(750); await f.sample();
  expect(f.sent).toHaveLength(1);
});
it('keeps cancellation ownership if started notification precedes request reply', async () => {
  const f = fixture(); await launch(f);
  f.controller.event({ method: 'turn/started', params: { threadId: 't', turn: { id: 'r' } } });
  f.controller.client({ id: 3, method: 'turn/start', params: { threadId: 't' } });
  await settle(f);
  f.replies.shift()({ error: { code: -1 } }); await Promise.resolve();
  expect(f.controller.uncertain).toBe(true); expect(f.forwarded).toEqual([]);
  complete(f); expect(f.forwarded).toHaveLength(1);
});


it('bounds an owned semantic turn to thirty seconds without interrupting user work', async () => {
  const f = fixture(); await launch(f); await settle(f);
  f.advance(30000); await f.sample();
  expect(f.sent[1]).toEqual({ method: 'turn/interrupt', params: { threadId: 't', turnId: 'r' } });
  await f.sample(); expect(f.sent).toHaveLength(2);
  complete(f); f.output.turn = 'user'; f.output.state = 'working'; f.advance(30000); await f.sample();
  expect(f.sent).toHaveLength(2);
});

it('dispatches a continuous event burst after a finite window using its newest cue', async () => {
  const f = fixture(); await f.sample();
  for (let seq = 1; seq <= 100; seq++) {
    await f.sample([f.event(seq === 100 ? 'user_left' : 'user_arrived', seq)]);
    if (seq < 100) f.advance(7);
  }
  expect(f.sent).toHaveLength(0);
  f.advance(57); await f.sample();
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0].params.toolOutput.output).toContain('user_left');
  expect(f.sent[0].params.toolOutput.output).not.toContain('user_arrived');
});
it('uses a monotonic deadline despite wall-clock rollback and retains transport isolation', async () => {
  const f = fixture(); let wall = 100000;
  f.controller.wallNow = () => wall;
  const sample = events => f.sample(events, { capturedAt: wall });
  await sample([]); await sample([{ type: 'user_arrived', seq: 1, at: wall }]);
  f.advance(750); await sample([]); await settle(f);
  wall -= 3600000; f.advance(30000); await sample([]);
  expect(f.controller.terminal).toBe('timedOut');
  expect(f.controller.revoked).toBe(true);
  expect(f.sent[1].method).toBe('turn/interrupt');
  f.advance(20000); await sample([{ type: 'user_left', seq: 2, at: wall }]);
  f.advance(750); await sample([]);
  expect(f.sent.filter(value => value.method === 'turn/start')).toHaveLength(1);
  complete(f); expect(f.controller.terminal).toBe('timedOut');
});
it('rejects malformed and future timestamps without starting a reaction', async () => {
  const f = fixture(); await f.sample();
  await f.sample([{ type: 'user_arrived', seq: 1, at: NaN }]);
  await f.sample([{ type: 'user_arrived', seq: 2, at: 200000 }]);
  await f.sample([f.event('user_arrived', 3)], { capturedAt: Infinity });
  f.advance(750); await f.sample(); expect(f.sent).toEqual([]);
});
it('never resurrects a completed turn from duplicated late transport notifications', async () => {
  const f = fixture(); await launch(f); await settle(f); complete(f);
  f.controller.uncertain = true;
  f.controller.event({ method: 'turn/started', params: { threadId: 't', turn: { id: 'r' } } });
  expect(f.controller.active).toBeUndefined();
  expect(f.sent).toHaveLength(1);
});
