import { expect, it, vi } from 'vitest';
import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';
import { LiveOutput } from '../integrations/live-output.mjs';
import { ReactiveProviderError } from '../integrations/reactive-provider.mjs';

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fixture(provider = null, options = {}) {
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
    reject: (message, error) => rejected.push({ message, error }), log: code => logs.push(code), ...options });
  const candidate = id => {
    const request = { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: id, intentRevision: 0,
      presenceRevision: 1, deadline: 1000, requiredTrackIds: [] };
    return { request, observationWindow: { schemaVersion: 1, request: { ...request },
      events: [{ id: 1, type: id === 'left' ? 'user_left' : 'user_arrived', at: 100 }],
      observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100, camera: 'absent', turn: 'idle', summary: 'local',
        user: { present: false, quality: { score: 0, basis: 'unavailable' }, position: null, head: null,
          expression: null, facingScreen: null, mouthMoving: null } }] } };
  };
  return { broker, page, state, api, output, forwarded, rejected, logs, deliveries, failures, candidates, candidate, order, calls };
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
  f.output.turn = 'u'; f.broker.event({ id: 1, result: { turn: { id: 'u', status: 'inProgress' } } });
  expect(f.broker.turns.has('u')).toBe(true); await f.broker.poll({}); expect(f.state.busy).toBe(true);
  f.output.turn = undefined;
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
  g.state.barrier = () => new Promise(resolve => { release = resolve; }); g.broker.client(message); await flush(); g.output.turn = 'new'; release(); await flush();
  expect(g.forwarded).toHaveLength(0); expect(g.rejected).toHaveLength(1); g.broker.close();
});
it('retains one active transport across semantic revocation and unknown failure, but user input still works', async () => {
  let reject, signal; const f = fixture({ decide: (_value, value) => { signal = value; return new Promise((_resolve, fail) => { reject = fail; }); } });
  f.candidates.push(f.candidate('r')); await f.broker.poll({}); await flush();
  f.broker.client({ id: 1, method: 'turn/start', params: { threadId: 'native' } }); expect(signal.aborted).toBe(true); await flush();
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
  await flush(); f.broker.close(); release(); await flush(); expect(f.forwarded).toHaveLength(0); expect(f.broker.pending.size).toBe(0);
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

it('bounds hanging native barriers and never forwards after their late resolution', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); let release, calls = 0;
    f.page.evaluate = () => { calls++; return new Promise(resolve => { release = resolve; }); };
    const message = { id: 1, method: 'turn/start', params: { threadId: 'native' } };
    f.broker.client(message); await flush(); await vi.advanceTimersByTimeAsync(9999);
    expect(f.rejected).toHaveLength(0); await vi.advanceTimersByTimeAsync(1);
    expect(f.rejected).toHaveLength(1); expect(f.forwarded).toEqual([]); expect(f.broker.browserUnavailable).toBe(true);
    f.broker.client({ ...message, id: 2 }); await f.broker.poll({}); expect(calls).toBe(1);
    release(true); await flush(); expect(f.forwarded).toEqual([]); expect(f.rejected).toHaveLength(2);
    expect(f.broker.client({ method: 'initialize' })).toBe(true); f.broker.close(); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('bounds authorization waits and suppresses provider results after independent browser failure', async () => {
  vi.useFakeTimers();
  try {
    let providerCalls = 0; const f = fixture({ decide: async () => { providerCalls++; return {}; } }, { evaluateTimeoutMs: 10 });
    f.state.authorize = () => new Promise(() => {}); f.candidates.push(f.candidate('auth'));
    await f.broker.poll({}); await flush(); await vi.advanceTimersByTimeAsync(10);
    expect(providerCalls).toBe(0); expect(f.broker.browserUnavailable).toBe(true); f.broker.close();
    let resolve; const g = fixture({ decide: () => new Promise(done => { resolve = done; }) }, { evaluateTimeoutMs: 10 });
    g.candidates.push(g.candidate('result')); await g.broker.poll({}); await flush();
    g.page.evaluate = async () => { throw Error('private browser error'); };
    await g.broker.poll({}); resolve({ mode: 'express' }); await flush(); expect(g.deliveries).toEqual([]);
    expect(g.broker.browserUnavailable).toBe(true); g.broker.close(); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('close rejects outstanding browser waits and clears timers before late callbacks', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); let release;
    f.page.evaluate = () => new Promise(resolve => { release = resolve; });
    f.broker.client({ id: 1, method: 'thread/start', params: {} }); await flush(); expect(vi.getTimerCount()).toBe(1);
    f.broker.close(); await flush(); expect(f.rejected).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
    release(true); await flush(); expect(f.forwarded).toEqual([]); expect(f.broker.waiters.size).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('rejects mismatched causal envelopes and invalid outer context before authorization or provider cost', async () => {
  const patches = [{ requestId: 'other' }, { epoch: 'other' }, { sessionId: 'other' }, { schemaVersion: 2 },
    { intentRevision: 1 }, { deadline: 1001 }, { presenceRevision: 2 },
    { requiredTrackIds: ['different'] }, { privateContext: 'PRIVATE_CODING_CANARY' }, { requestId: 'invalid:id' }];
  for (const patch of patches) {
    let calls = 0, authorizations = 0; const f = fixture({ decide: async () => { calls++; return {}; } });
    f.state.authorize = async () => { authorizations++; return true; };
    const candidate = f.candidate('r'); candidate.request = { ...candidate.request, ...patch };
    f.candidates.push(candidate); await f.broker.poll({}); await flush();
    expect(calls).toBe(0); expect(authorizations).toBe(0); expect(f.deliveries).toHaveLength(1);
    expect(f.deliveries[0].data).toBe(null); expect(f.logs.join('')).not.toContain('PRIVATE_CODING_CANARY'); f.broker.close();
  }
});
it('rejects missing presence and empty observation/event windows before dispatch', async () => {
  for (const change of [candidate => { delete candidate.observationWindow.request.presenceRevision; },
    candidate => { candidate.observationWindow.events = []; }, candidate => { candidate.observationWindow.observations = []; }]) {
    let calls = 0; const f = fixture({ decide: async () => { calls++; return {}; } });
    const candidate = f.candidate('r'); change(candidate); f.candidates.push(candidate);
    await f.broker.poll({}); await flush(); expect(calls).toBe(0); expect(f.deliveries[0].data).toBe(null); f.broker.close();
  }
});
it('freezes the authorized payload before an asynchronous authorization wait', async () => {
  let release, received; const f = fixture({ decide: async value => { received = value; return {}; } });
  f.state.authorize = () => new Promise(resolve => { release = resolve; });
  const candidate = f.candidate('r'); f.candidates.push(candidate); await f.broker.poll({}); await flush();
  candidate.observationWindow.request.epoch = 'changed'; candidate.observationWindow.events[0].type = 'user_left';
  release(true); await flush(); expect(received.request.epoch).toBe('e'); expect(received.events[0].type).toBe('user_arrived');
  expect(Object.isFrozen(received.request)).toBe(true); f.broker.close();
});

it('steers the acknowledged native turn before its started notification without weakening either barrier check', async () => {
  const output = new LiveOutput(); output.thread = 'native'; const f = fixture(null, { output });
  const start = { id: 501, method: 'turn/start', params: { threadId: 'native', input: [] } };
  output.request(start); f.broker.client(start); await flush();
  const acknowledged = { id: 501, result: { turn: { id: 'acknowledged', status: 'inProgress' } } };
  output.accept(acknowledged); f.broker.event(acknowledged);
  const steer = { id: 502, method: 'turn/steer', params: { threadId: 'native', expectedTurnId: 'acknowledged', input: [] } };
  f.broker.client(steer); await flush();
  expect(f.rejected).toEqual([]); expect(f.forwarded.map(message => message.method)).toEqual(['turn/start', 'turn/steer']);
  f.broker.close();
});

it('rejects steer ownership after error, wrong-thread, completed and changed-thread native ACKs', async () => {
  for (const reason of ['error', 'wrong_thread', 'completed', 'changed_thread']) {
    const output = new LiveOutput(); output.thread = 'native'; const f = fixture(null, { output });
    const start = { id: 601, method: 'turn/start', params: { threadId: reason === 'wrong_thread' ? 'other' : 'native' } };
    output.request(start); f.broker.client(start); await flush();
    if (reason === 'completed') {
      const complete = { method: 'turn/completed', params: { threadId: 'native', turn: { id: 'old', status: 'completed' } } };
      output.accept(complete); f.broker.event(complete);
    }
    if (reason === 'changed_thread') { output.request({ id: 602, method: 'thread/resume' }); output.accept({ id: 602, result: { thread: { id: 'new' } } }); }
    const ack = reason === 'error' ? { id: 601, error: { code: -1 } } : { id: 601, result: { turn: { id: 'old', status: 'inProgress' } } };
    output.accept(ack); f.broker.event(ack); expect(output.turn).toBeUndefined(); expect(f.broker.turns.size).toBe(0);
    f.broker.client({ id: 603, method: 'turn/steer', params: { threadId: 'native', expectedTurnId: 'old' } }); await flush();
    expect(f.rejected.at(-1).error.message).toBe('reactive_steer_invalid'); expect(f.forwarded).toHaveLength(1); f.broker.close();
  }
});

it('advertises the supported hand-event contract explicitly without resetting availability on repeated polls', async () => {
  const f = fixture({ decide: async () => null }), configured = [];
  f.api.configureReactive = (...args) => configured.push(args);
  await f.broker.poll({}); await f.broker.poll({});
  expect(configured).toEqual([[true, 1, 1], [true, 1, 1]]); f.broker.close();
});
it('confirms Native publication only after the browser critical fence with the exact owned request', async () => {
  const provider = { conversationLane: true, confirmPublication: vi.fn(), discardPublication: vi.fn() }, f = fixture(provider);
  const candidate = f.candidate('published'), owned = { id: 'published', request: candidate.request, controller: new AbortController(), terminal: false };
  f.broker.active = owned; f.api.canRememberNativeReaction = request => request.requestId === 'published';
  const receipt = { source: 'native-observation', requestId: 'published', decisionId: 'd', reason: 'observed', chatPublished: true };
  f.api.deliverNativeReaction = async () => receipt;
  await f.broker.finish(owned, { reply: 'published' });
  expect(provider.confirmPublication).toHaveBeenCalledWith(candidate.request, receipt); expect(f.broker.active).toBeUndefined(); f.broker.close();
});
it('drops history confirmation after stop/epoch rejection, unknown delivery, or user intent arriving during the fence await', async () => {
  for (const mode of ['browser-revoked', 'unknown-delivery', 'late-user']) {
    const provider = { conversationLane: true, confirmPublication: vi.fn(), discardPublication: vi.fn() }, f = fixture(provider);
    const request = f.candidate(mode).request, owned = { id: mode, request, controller: new AbortController(), terminal: false }; f.broker.active = owned;
    f.api.canRememberNativeReaction = () => mode !== 'browser-revoked';
    f.api.deliverNativeReaction = async () => { if (mode === 'unknown-delivery') throw Error('unknown'); return { reason: 'observed', chatPublished: true }; };
    const evaluate = f.broker.evaluate.bind(f.broker);
    f.broker.evaluate = async (fn, arg) => { const result = await evaluate(fn, arg); if (mode === 'late-user' && arg === request) owned.controller.abort(); return result; };
    await f.broker.finish(owned, { reply: 'must not remember' });
    expect(provider.confirmPublication).not.toHaveBeenCalled(); f.broker.close();
  }
});

it('does not cancel consumed requests while publication confirmation is pending', async () => {
  for (const terminal of [false, true]) {
    const f = fixture({ conversationLane: true, discardPublication: vi.fn() });
    const controller = new AbortController(); f.broker.active = { id: 'r', terminal, controller };
    f.api.canContinueNativeReaction = vi.fn(() => false);
    try {
      await f.broker.poll({});
      expect(controller.signal.aborted).toBe(!terminal);
      expect(f.api.canContinueNativeReaction).toHaveBeenCalledTimes(terminal ? 0 : 1);
    } finally { f.broker.close(); }
  }
});

it('ignores an old inference poll when delivery started or ownership changed during await', async () => {
  for (const change of ['delivery', 'replacement']) {
    const f = fixture({ conversationLane: true }); let release;
    const inference = { id: 'old', terminal: false, controller: new AbortController() }; f.broker.active = inference;
    f.page.evaluate = () => new Promise(resolve => { release = resolve; });
    try {
      const polling = f.broker.poll({}); await flush();
      if (change === 'delivery') inference.terminal = true;
      else f.broker.active = { id: 'new', terminal: false, controller: new AbortController() };
      release({ activeAllowed: false }); await polling;
      expect(inference.controller.signal.aborted).toBe(false);
      expect(f.broker.active.controller.signal.aborted).toBe(false);
    } finally { f.broker.close(); }
  }
});
it.each(['eval_rejected', 'deadline', 'capacity', 'closed'])('records fixed %s diagnostics without changing fail-closed behavior', async reason => {
  vi.useFakeTimers();
  const f = fixture(null, { evaluateTimeoutMs: 10 }); const pending = [];
  try {
    if (reason === 'closed') f.broker.close();
    else if (reason === 'eval_rejected') f.page.evaluate = async () => { throw Error('PRIVATE_BROWSER_INPUT'); };
    else f.page.evaluate = () => new Promise(() => {});
    if (reason === 'capacity') for (let i = 0; i < 4; i++) pending.push(f.broker.evaluate(() => {}, null, 'poll').catch(error => error));
    const rejected = f.broker.evaluate(() => {}, { private: 'PRIVATE_BROWSER_INPUT' }, 'publication_fence').catch(error => error);
    if (reason === 'deadline') await vi.advanceTimersByTimeAsync(10);
    expect((await rejected).message).toBe('reactive_browser_unavailable'); await Promise.all(pending);
    expect(f.broker.diagnostics()).toEqual({ reason, operation: 'publication_fence' });
    expect(JSON.stringify(f.broker.diagnostics())).not.toContain('PRIVATE'); expect(f.broker.waiters.size).toBe(0);
    expect(f.broker.browserUnavailable).toBe(reason !== 'closed');
    expect(f.broker.paused).toBe(reason !== 'closed'); expect(f.broker.uncertain).toBe(reason !== 'closed');
    const copy = f.broker.diagnostics(); copy.reason = 'changed'; expect(f.broker.diagnostics().reason).toBe(reason);
    await f.broker.evaluate(() => {}, undefined, 'other').catch(() => {}); expect(f.broker.diagnostics().reason).toBe(reason);
  } finally { f.broker.close(); vi.useRealTimers(); }
});
it('labels actual poll rejections and normalizes unknown caller labels without retaining their contents', async () => {
  const f = fixture(); f.api.activity = () => { throw Error('PRIVATE_PAGE_EXCEPTION'); };
  await f.broker.poll({}); expect(f.broker.diagnostics()).toEqual({ reason: 'eval_rejected', operation: 'poll' }); f.broker.close();
  const g = fixture(); g.page.evaluate = async () => { throw Error('PRIVATE'); };
  await g.broker.evaluate(() => {}, null, 'PRIVATE_UNTRUSTED_LABEL').catch(() => {});
  expect(g.broker.diagnostics()).toEqual({ reason: 'eval_rejected', operation: 'other' }); g.broker.close();
});
