import { expect, it, vi } from 'vitest';
import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';
import { ReactiveProviderError } from '../integrations/reactive-provider.mjs';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(provider = null) {
  const forwarded = [], rejected = [], logs = [], deliveries = [], failures = [], candidates = [], order = [], calls = [];
  const output = { thread: 'native', turn: undefined }, state = { busy: false, available: false, takes: 0, authorize: async () => true, barrier: async () => {} };
  const api = { activity: value => calls.push(value), logActivity: () => {}, configureReactive: value => { state.available = value; },
    setReactiveUserBusy: value => { state.busy = value; }, takeReactiveRequest: () => { state.takes++; return candidates.shift() ?? null; },
    authorizeReactiveRequest: async id => state.authorize(id),
    reactiveUserIntent: async () => { order.push('barrier'); await state.barrier(); order.push('revoked'); },
    deliverReactiveDecision: async (id, data) => { deliveries.push({ id, data }); return { reason: data ? 'accepted' : 'invalid_decision' }; },
    failReactiveDecision: async id => { failures.push(id); return { reason: 'transport_unknown' }; } };
  const page = { evaluate: async (fn, arg) => {
    const old = globalThis.window; globalThis.window = { fischLive: api };
    try { return await fn(arg); } finally { globalThis.window = old; }
  } };
  const broker = new LiveReactiveBroker({ page, provider, output, forward: message => { order.push('forward'); forwarded.push(message); },
    reject: (message, error) => rejected.push({ message, error }), log: code => logs.push(code) });
  const candidate = id => ({ request: { requestId: id }, observationWindow: { schemaVersion: 1, events: [{ type: id === 'left' ? 'user_left' : 'user_arrived' }] } });
  return { broker, state, api, output, forwarded, rejected, logs, deliveries, failures, candidates, candidate, order, calls };
}
it('routes arrival/left only to separate provider data and never selected native thread', async () => {
  const received = [], f = fixture({ decide: async (value, signal) => { received.push(value); expect(signal.aborted).toBe(false); return { mode: 'observe' }; } });
  for (const id of ['arrival', 'left']) { f.candidates.push(f.candidate(id)); await f.broker.poll({ turn: 'idle' }); await flush(); }
  expect(received.map(item => item.events[0].type)).toEqual(['user_arrived', 'user_left']);
  expect(JSON.stringify(received)).not.toContain('native'); expect(f.forwarded).toEqual([]); expect(f.deliveries).toHaveLength(2);
  f.broker.close();
});
it('does not take requests without provider and never forwards returned private/tool text to native transport', async () => {
  const off = fixture(); await off.broker.poll({}); expect(off.state.takes).toBe(0); off.broker.close();
  const value = { tool: 'shell', text: 'PRIVATE_CODING_CANARY', arguments: 'run()' }, f = fixture({ decide: async () => value });
  f.candidates.push(f.candidate('r')); await f.broker.poll({}); await flush();
  expect(f.forwarded).toEqual([]); expect(f.logs.join('')).not.toContain('PRIVATE_CODING_CANARY'); f.broker.close();
});
it('awaits user revocation before forwarding unchanged input and stays busy through RPC ack and completion', async () => {
  const f = fixture(); let release;
  f.state.barrier = () => new Promise(resolve => { release = resolve; });
  const message = { id: 1, method: 'turn/start', params: { threadId: 'native', input: [{ text: 'private' }] } };
  expect(f.broker.client(message)).toBe(false); expect(f.forwarded).toHaveLength(0);
  await f.broker.poll({}); expect(f.state.busy).toBe(true);
  release(); await flush(); expect(f.order).toEqual(['barrier', 'revoked', 'forward']); expect(f.forwarded[0]).toBe(message);
  await f.broker.poll({}); expect(f.state.busy).toBe(true);
  f.broker.event({ id: 1, result: { turn: { id: 'u' } } }); await f.broker.poll({}); expect(f.state.busy).toBe(true);
  f.broker.event({ method: 'turn/completed', params: { threadId: 'native', turn: { id: 'u' } } });
  await f.broker.poll({}); expect(f.state.busy).toBe(false); f.broker.close();
});
it('barriers thread selection and interrupt, rejects failures without forwarding or retry', async () => {
  for (const method of ['thread/start', 'thread/resume', 'thread/fork', 'turn/interrupt']) {
    const f = fixture(); f.state.barrier = async () => { throw Error('private failure'); };
    expect(f.broker.client({ id: 1, method, params: {} })).toBe(false); await flush();
    expect(f.forwarded).toHaveLength(0); expect(f.rejected[0].error.message).toBe('reactive_user_barrier_failed');
    expect(f.logs.join('')).not.toContain('private'); f.broker.close();
  }
});
it('only steers a current native turn and checks again after barrier', async () => {
  const f = fixture(); f.output.turn = 'u';
  const message = { id: 1, method: 'turn/steer', params: { threadId: 'native', expectedTurnId: 'u', input: [] } };
  f.broker.client({ ...message, id: 2, params: { ...message.params, expectedTurnId: 'wrong' } });
  expect(f.rejected).toHaveLength(1); f.broker.client(message); await flush(); expect(f.forwarded).toEqual([message]);
  f.broker.close(); const g = fixture(); g.output.turn = 'u'; let release;
  g.state.barrier = () => new Promise(resolve => { release = resolve; }); g.broker.client(message); g.output.turn = 'new'; release(); await flush();
  expect(g.forwarded).toHaveLength(0); expect(g.rejected).toHaveLength(1); g.broker.close();
});
it('retains one active transport across semantic revocation and unknown failure, but user input still works', async () => {
  let reject, signal; const f = fixture({ decide: (_value, value) => { signal = value; return new Promise((_resolve, fail) => { reject = fail; }); } });
  f.candidates.push(f.candidate('r')); await f.broker.poll({}); await flush();
  f.broker.client({ id: 1, method: 'turn/start', params: { threadId: 'native' } }); await flush(); expect(signal.aborted).toBe(false);
  reject(Object.assign(Error('reactive_decision_invalid'), { transportSettled: true })); await flush(); expect(f.failures).toEqual(['r']);
  const takes = f.state.takes; await f.broker.poll({}); expect(f.state.takes).toBe(takes);
  expect(f.forwarded).toHaveLength(1); f.broker.close();
});
it('hard timeout aborts only provider and blocks future reactive requests and late delivery', async () => {
  vi.useFakeTimers();
  try {
    let resolve, signal; const f = fixture({ decide: (_value, value) => { signal = value; return new Promise(done => { resolve = done; }); } });
    f.candidates.push(f.candidate('r')); await f.broker.poll({}); await flush();
    await vi.advanceTimersByTimeAsync(30000); expect(signal.aborted).toBe(true); expect(f.failures).toEqual(['r']);
    resolve({ mode: 'express' }); await flush(); expect(f.deliveries).toHaveLength(0);
    const takes = f.state.takes; await f.broker.poll({}); expect(f.state.takes).toBe(takes); expect(f.forwarded).toEqual([]); f.broker.close();
  } finally { vi.useRealTimers(); }
});
it('settled invalid decisions release browser slots while budget denial pauses future dispatch', async () => {
  for (const code of ['reactive_decision_invalid', 'reactive_budget_denied']) {
    const f = fixture({ decide: async () => { throw new ReactiveProviderError(code, true); } });
    f.candidates.push(f.candidate('r')); await f.broker.poll({}); await flush(); expect(f.deliveries).toEqual([{ id: 'r', data: null }]);
    const takes = f.state.takes; await f.broker.poll({}); expect(f.state.takes).toBe(code === 'reactive_budget_denied' ? takes : takes + 1); f.broker.close();
  }
});
it('bounds duplicate user delivery, queue and completed history and cleans up on close', async () => {
  const f = fixture(); let release; f.state.barrier = () => new Promise(resolve => { release = resolve; });
  const message = { id: 1, method: 'turn/start', params: {} }; f.broker.client(message); f.broker.client(message);
  for (let id = 2; id <= 10; id++) f.broker.client({ ...message, id });
  expect(f.broker.queue.length).toBe(7); expect(f.broker.pending.size).toBe(8);
  f.broker.close(); release(); await flush(); expect(f.forwarded).toHaveLength(0); expect(f.broker.pending.size).toBe(0);
  expect(f.broker.client({ method: 'initialize' })).toBe(true);
});
it('does not resurrect native busy state on acknowledgement arriving after completion', async () => {
  const f = fixture(); f.broker.client({ id: 1, method: 'turn/start', params: { threadId: 'native' } }); await flush();
  f.broker.event({ method: 'turn/completed', params: { threadId: 'native', turn: { id: 'u' } } });
  f.broker.event({ id: 1, result: { turn: { id: 'u' } } }); await f.broker.poll({}); expect(f.state.busy).toBe(false); f.broker.close();
});

it('authorizes once after pull and rejects intervening revocation without calling provider', async () => {
  let release, calls = 0;
  const f = fixture({ decide: async () => { calls++; return {}; } });
  f.state.authorize = () => new Promise(resolve => { release = resolve; });
  f.candidates.push(f.candidate('r')); await f.broker.poll({}); await flush();
  const takes = f.state.takes; await f.broker.poll({}); expect(f.state.takes).toBe(takes);
  release(false); await flush(); expect(calls).toBe(0); expect(f.deliveries).toEqual([{ id: 'r', data: null }]); f.broker.close();
});
it('deduplicates pulled request IDs before provider cost and ignores callbacks after close', async () => {
  let calls = 0; const f = fixture({ decide: async () => { calls++; return {}; } });
  f.candidates.push(f.candidate('r')); await f.broker.poll({}); await flush();
  f.candidates.push(f.candidate('r')); await f.broker.poll({}); await flush(); expect(calls).toBe(1); f.broker.close();
  let release; const g = fixture({ decide: async () => { calls++; return {}; } });
  g.state.authorize = () => new Promise(resolve => { release = resolve; }); g.candidates.push(g.candidate('later'));
  await g.broker.poll({}); await flush(); g.broker.close(); release(true); await flush(); expect(calls).toBe(1); expect(g.deliveries).toEqual([]);
});
