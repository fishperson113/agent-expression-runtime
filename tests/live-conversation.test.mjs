import { expect, it, vi } from 'vitest';
import { LiveOutput } from '../integrations/live-output.mjs';
import { LiveConversation, bindLiveConversation } from '../integrations/live-conversation.mjs';

function fixture(options = {}) {
  const output = new LiveOutput(); output.thread = 'thread-a';
  const broker = { pending: new Map(), turns: new Set(), queue: [], busy() { return !!(this.pending.size || this.turns.size || output.turn || output.selection !== undefined); } };
  const calls = []; let conversation;
  const request = (method, params, guard, discard) => new Promise((resolve, reject) => {
    const message = { id: 'owned-' + calls.length, method, params };
    if (!guard(message)) { reject(Object.assign(Error('private guard'), { uncertain: false })); return; }
    output.request(message); broker.pending.set(message.id, {});
    calls.push({ message, guard, discard, resolve, reject });
  });
  const transport = { submitUser: (p, g, d) => request('turn/start', p, g, d), interruptUser: (p, g, d) => request('turn/interrupt', p, g, d) };
  conversation = new LiveConversation({ output, broker, transport, ...options });
  const event = message => { output.accept(message); conversation.accept(message); };
  const reply = (index, response) => {
    const call = calls[index], message = { id: call.message.id, ...response };
    event(message); broker.pending.delete(message.id); call.resolve(message);
  };
  const fail = (index, uncertain = true) => { const call = calls[index]; broker.pending.delete(call.message.id); call.reject(Object.assign(Error('PRIVATE_TRANSPORT_CANARY'), { uncertain })); };
  const select = thread => { conversation.selectionAttempt(); output.request({ id: 'selection', method: 'thread/resume' }); event({ id: 'selection', result: { thread: { id: thread } } }); };
  const send = text => conversation.send({ text: text ?? 'synthetic user text', generation: conversation.snapshot().generation });
  return { output, broker, calls, conversation, event, reply, fail, select, send };
}
const delta = (f, text, itemId = 'item-a', turnId = 'turn-a') => f.event({ method: 'item/agentMessage/delta', params: { threadId: f.output.thread, turnId, itemId, delta: text } });

it('uses canonical ACK-only ownership for streaming and captured cancellation', async () => {
  const f = fixture(), pending = f.send();
  expect(f.calls[0].message.params.threadId).toBe('thread-a');
  expect(f.calls[0].guard(f.calls[0].message)).toBe(true);
  f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  delta(f, 'actual synthetic delta');
  expect(f.conversation.snapshot()).toMatchObject({ canCancel: true, messages: [{ text: 'actual synthetic delta' }] });
  const cancel = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  expect(f.calls[1].message.params).toEqual({ threadId: 'thread-a', turnId: 'turn-a' });
  f.reply(1, { result: {} }); await cancel;
  expect(f.conversation.snapshot().stopping).toBe(true);
  f.event({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'interrupted' } } });
  expect(f.conversation.snapshot().messages[0].status).toBe('interrupted');
});

it('keeps sent-unknown sticky across failed/same selection and returning to that thread', async () => {
  const f = fixture(), pending = f.send(); f.fail(0); await expect(pending).rejects.toThrow('conversation_unknown');
  f.conversation.selectionAttempt(); f.output.request({ id: 'failed', method: 'thread/resume' });
  f.event({ id: 'failed', error: { code: -1 } });
  expect(f.conversation.snapshot()).toMatchObject({ canSend: false, error: 'conversation_unknown' });
  f.select('thread-a'); expect(f.conversation.snapshot().canSend).toBe(false);
  f.select('thread-b'); expect(f.conversation.snapshot().canSend).toBe(true);
  f.select('thread-a'); expect(f.conversation.snapshot().canSend).toBe(false);
  expect(JSON.stringify(f.conversation.snapshot())).not.toContain('PRIVATE_TRANSPORT_CANARY');
});

it('does not resurrect completed turns or show tools, reasoning or other-thread text', async () => {
  const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  delta(f, 'first');
  f.event({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } } });
  f.event({ method: 'turn/started', params: { threadId: 'thread-a', turn: { id: 'turn-a' } } }); delta(f, 'late');
  expect(f.output.turn).toBeUndefined(); expect(f.conversation.snapshot().canCancel).toBe(false);
  expect(f.conversation.snapshot().messages.map(x => x.text)).toEqual(['first']);
  for (const type of ['mcpToolCall', 'reasoning', 'commandExecution']) f.event({ method: 'item/completed', params: { threadId: 'thread-a', turnId: 'turn-a', item: { type, id: 'private', text: 'PRIVATE_TOOL_CANARY' } } });
  expect(JSON.stringify(f.conversation.snapshot())).not.toContain('PRIVATE_TOOL_CANARY');
});

it('invalidates queued guards on selection without treating proven prewrite failure as unknown', async () => {
  const f = fixture(), pending = f.send(); const original = f.calls[0].message;
  f.conversation.selectionAttempt(); expect(f.calls[0].guard(original)).toBe(false);
  f.fail(0, false); await expect(pending).rejects.toThrow('conversation_changed');
  expect(f.conversation.snapshot().canSend).toBe(true);
});

it('bounds transcripts and IDs and returns independent deeply immutable snapshots', async () => {
  const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  delta(f, 'x'.repeat(70000)); expect(f.conversation.snapshot().messages[0]).toMatchObject({ truncated: true, text: 'x'.repeat(64000) });
  for (let n = 0; n < 100; n++) delta(f, 'x'.repeat(5000), 'item-' + n);
  delta(f, 'ignored', 'x'.repeat(129));
  const value = f.conversation.snapshot(); expect(value.messages.length).toBeLessThanOrEqual(80);
  expect(value.messages.reduce((n, x) => n + x.text.length, 0)).toBeLessThanOrEqual(128000);
  expect(() => value.messages.push({})).toThrow(); expect(() => { value.messages[0].text = 'tampered'; }).toThrow();
  delta(f, 'new', 'new-item'); expect(value.messages.some(x => x.id === 'new-item')).toBe(false);
});

it('requires strict input bounds, current selection and no competing native work', async () => {
  const f = fixture();
  for (const text of ['', ' ', 'x'.repeat(16001)]) await expect(f.send(text)).rejects.toThrow('conversation_invalid_text');
  f.broker.pending.set('native-other', {}); await expect(f.send()).rejects.toThrow('conversation_unavailable');
  f.broker.pending.clear(); f.output.selection = 'selecting'; await expect(f.send()).rejects.toThrow('conversation_unavailable');
});

it('clears private buffers and invalidates generations on navigation and close', async () => {
  const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  delta(f, 'private conversation'); const old = f.conversation.snapshot().generation;
  f.conversation.navigation(); delta(f, 'late private text');
  expect(f.conversation.snapshot()).toMatchObject({ available: false, messages: [] });
  expect(f.conversation.snapshot().generation).toBeGreaterThan(old);
  await expect(f.send()).rejects.toThrow('conversation_unavailable');
  f.conversation.close(); expect(f.conversation.snapshot().messages).toEqual([]);
});

it('binds only the expected live main frame and clears on main-frame navigation', async () => {
  const f = fixture(); let binding; const listeners = new Map();
  const frame = { url: () => 'http://127.0.0.1:123/live.html?mode=live' };
  const page = { url: frame.url, mainFrame: () => frame, isClosed: () => false, on: (n, fn) => listeners.set(n, fn), off: (n) => listeners.delete(n), exposeBinding: async (_n, fn) => { binding = fn; } };
  const dispose = await bindLiveConversation(page, f.conversation);
  expect(() => binding({ page, frame: { url: frame.url } }, { action: 'send' })).toThrow('conversation_source_rejected');
  frame.url = () => 'http://127.0.0.1:123/live.html?mode=other';
  expect(() => binding({ page, frame }, { action: 'send' })).toThrow('conversation_source_rejected');
  listeners.get('framenavigated')(frame); expect(f.conversation.snapshot().available).toBe(false);
  dispose(); expect(listeners.size).toBe(0);
});

it('preserves view generation and transcript on failed or same-thread selection while invalidating guards', async () => {
  const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  delta(f, 'keep transcript'); const before = f.conversation.snapshot();
  f.conversation.selectionAttempt(); f.output.request({ id: 'bad', method: 'thread/resume' });
  f.event({ id: 'bad', error: { code: -1 } });
  expect(f.conversation.snapshot().generation).toBe(before.generation);
  expect(f.conversation.snapshot().messages).toEqual(before.messages);
  f.select('thread-a'); expect(f.conversation.snapshot().generation).toBe(before.generation);
  expect(f.conversation.snapshot().messages).toEqual(before.messages);
  f.select('thread-b'); expect(f.conversation.snapshot().generation).toBeGreaterThan(before.generation);
  expect(f.conversation.snapshot().messages).toEqual([]);
});

it('does not create a hidden thread at cold start and bounds Unicode transcript bytes', async () => {
  const f = fixture(); f.output.thread = undefined;
  expect(f.conversation.snapshot()).toMatchObject({ available: false, canSend: false });
  await expect(f.send()).rejects.toThrow('conversation_unavailable'); expect(f.calls).toEqual([]);
  f.select('thread-a'); const pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  delta(f, '🙂'.repeat(20000)); const text = f.conversation.snapshot().messages[0].text;
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(64000); expect(text).not.toContain('\uFFFD');
});

it('limits user text to 16000 UTF-8 bytes and binds private discard to its captured RPC id', async () => {
  const f = fixture(); await expect(f.send('🙂'.repeat(4001))).rejects.toThrow('conversation_invalid_text');
  const pending = f.send(); f.broker.pending.set('native-unrelated', {});
  f.calls[0].discard('native-unrelated'); expect(f.broker.pending.has('native-unrelated')).toBe(true);
  f.broker.pending.delete('native-unrelated'); f.fail(0, false); await expect(pending).rejects.toThrow('conversation_rejected');
  expect(f.calls[0].guard(f.calls[0].message)).toBe(false);
});

it('retains unknown metadata without unbounded eviction and fails closed at 64 threads', async () => {
  const f = fixture();
  for (let n = 0; n < 64; n++) {
    f.select('thread-' + n); const pending = f.send(); f.fail(n); await expect(pending).rejects.toThrow('conversation_unknown');
  }
  f.select('new-thread'); expect(f.conversation.snapshot()).toMatchObject({ canSend: false, error: 'conversation_capacity' });
  await expect(f.send()).rejects.toThrow('conversation_unavailable');
  f.select('thread-0'); expect(f.conversation.snapshot().error).toBe('conversation_unknown');
});

it('does not invent successful completion from missing or unknown terminal status', async () => {
  for (const status of [undefined, 'future_status']) {
    const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
    delta(f, 'partial reply');
    f.event({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status } } });
    expect(f.conversation.snapshot()).toMatchObject({ error: 'conversation_completion_unknown', messages: [{ status: 'unknown' }] });
  }
});

it('does not rewrite first terminal outcome with a contradictory late completion', async () => {
  const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  delta(f, 'partial reply');
  for (const status of ['interrupted', 'completed']) f.event({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status } } });
  expect(f.conversation.snapshot().messages[0].status).toBe('interrupted');
});

it('allows explicit cancellation of canonical current turn while unknown resend remains blocked', async () => {
  const f = fixture(), pending = f.send(); f.fail(0); await expect(pending).rejects.toThrow('conversation_unknown');
  f.event({ method: 'turn/started', params: { threadId: 'thread-a', turn: { id: 'turn-a' } } });
  expect(f.conversation.snapshot()).toMatchObject({ canSend: false, canCancel: true, error: 'conversation_unknown' });
  const cancel = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  const call = f.calls[1]; expect(call.guard(call.message)).toBe(true);
  f.output.turn = 'newer-turn'; expect(call.guard(call.message)).toBe(false);
  f.reply(1, { error: { code: -1 } }); await expect(cancel).rejects.toThrow('conversation_stop_unconfirmed');
  expect(f.conversation.snapshot().canSend).toBe(false);
});

it('provides an actionable fixed restart code after main-frame navigation', () => {
  const f = fixture(); f.conversation.navigation();
  expect(f.conversation.snapshot()).toMatchObject({ available: false, error: 'conversation_restart_required', messages: [] });
});

it('allows only explicit retry after proven prewrite cancellation rejection', async () => {
  const f = fixture(), pending = f.send();
  f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  const cancel = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  f.fail(1, false); await expect(cancel).rejects.toThrow('conversation_stop_unconfirmed');
  expect(f.conversation.snapshot()).toMatchObject({ canCancel: true, stopping: false, canSend: false });
  expect(f.calls).toHaveLength(2);
  const retry = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  expect(f.conversation.snapshot()).toMatchObject({ error: '', stopping: true });
  expect(f.calls).toHaveLength(3); f.reply(2, { result: {} }); await retry;
  expect(f.conversation.snapshot()).toMatchObject({ canCancel: false, stopping: true });
});

it.each([-32600, -32601, -32602])('releases a rejected cancellation attempt for standard RPC error %s', async code => {
  const f = fixture(), pending = f.send();
  f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  const cancel = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  f.reply(1, { error: { code } }); await expect(cancel).rejects.toThrow('conversation_stop_unconfirmed');
  expect(f.conversation.snapshot()).toMatchObject({ canCancel: true, stopping: false });
  expect(f.calls).toHaveLength(2);
});

it('releases a proven unsent stop after a same-thread selection invalidates intent without projecting its error', async () => {
  const f = fixture(), pending = f.send();
  f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  const cancel = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  f.conversation.selectionAttempt();
  expect(f.calls[1].guard(f.calls[1].message)).toBe(false);
  f.fail(1, false); await expect(cancel).rejects.toThrow('conversation_stop_unconfirmed');
  expect(f.conversation.snapshot()).toMatchObject({ canCancel: true, stopping: false, error: '' });
});

it.each(['unknown', 'application', 'internal'])('keeps %s cancellation outcomes sticky without resending', async outcome => {
  const f = fixture(), pending = f.send();
  f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  const cancel = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  if (outcome === 'unknown') f.fail(1, true);
  else f.reply(1, { error: { code: outcome === 'internal' ? -32603 : -32000 } });
  await expect(cancel).rejects.toThrow('conversation_stop_unconfirmed');
  expect(f.conversation.snapshot()).toMatchObject({ canCancel: false, stopping: true });
  await f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  expect(f.calls).toHaveLength(2);
});

it.each(['terminal', 'thread', 'new_attempt'])('does not let a late cancellation error mutate %s ownership', async change => {
  const f = fixture(), pending = f.send();
  f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  const cancel = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  let next;
  if (change === 'thread') f.select('thread-b');
  else {
    f.event({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'interrupted' } } });
    if (change === 'new_attempt') {
      f.event({ method: 'turn/started', params: { threadId: 'thread-a', turn: { id: 'turn-b' } } });
      next = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
    }
  }
  const before = f.conversation.snapshot();
  f.fail(1, false); await expect(cancel).rejects.toThrow('conversation_stop_unconfirmed');
  expect(f.conversation.snapshot()).toMatchObject({ revision: before.revision, error: before.error, stopping: before.stopping });
  if (next) { f.reply(2, { result: {} }); await next; }
});

it('releases the old logical stop for a new canonical owner and clears only its stop error', async () => {
  const f = fixture(), pending = f.send();
  f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  const cancel = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  f.fail(1, true); await expect(cancel).rejects.toThrow('conversation_stop_unconfirmed');
  expect(f.conversation.snapshot()).toMatchObject({ ownerTurn: 'turn-a', stopping: true });
  f.event({ method: 'turn/started', params: { threadId: 'thread-a', turn: { id: 'turn-b' } } });
  expect(f.conversation.snapshot()).toMatchObject({ ownerTurn: 'turn-b', canCancel: true, stopping: false, error: '' });
  const next = f.conversation.cancel({ generation: f.conversation.snapshot().generation });
  f.reply(2, { result: {} }); await next;
});

it('keeps hash navigation usable but revokes queued writes before a same-URL reload', async () => {
  const f = fixture(); let url = 'http://127.0.0.1:123/live.html?mode=live'; const listeners = new Map();
  const frame = { url: () => url }, child = { url: () => url };
  const page = { url: frame.url, mainFrame: () => frame, isClosed: () => false, on: (n, fn) => listeners.set(n, fn), off: n => listeners.delete(n), exposeBinding: async () => {} };
  const dispose = await bindLiveConversation(page, f.conversation);
  const pending = f.send(), call = f.calls[0];
  url += '#workspace'; listeners.get('framenavigated')(frame);
  expect(f.conversation.snapshot().available).toBe(true); expect(call.guard(call.message)).toBe(true);
  listeners.get('request')({ isNavigationRequest: () => true, frame: () => child });
  listeners.get('framenavigated')(child); expect(call.guard(call.message)).toBe(true);
  listeners.get('request')({ isNavigationRequest: () => true, frame: () => frame });
  expect(call.guard(call.message)).toBe(false);
  expect(f.conversation.snapshot()).toMatchObject({ available: false, error: 'conversation_restart_required' });
  f.fail(0, false); await expect(pending).rejects.toThrow('conversation_changed');
  dispose(); expect(listeners.size).toBe(0);
});

it('treats missing or unknown turn-start ACK status as sticky unknown instead of accepted', async () => {
  for (const status of [undefined, 'future_status']) {
    const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status } } });
    await expect(pending).rejects.toThrow('conversation_unknown');
    expect(f.conversation.snapshot()).toMatchObject({ canSend: false, canCancel: false, error: 'conversation_unknown' });
  }
});

it('accepts recognized terminal ACKs without granting ownership or resurrecting completed turns', async () => {
  for (const status of ['completed', 'interrupted', 'failed']) {
    const f = fixture(), pending = f.send();
    f.event({ method: 'turn/started', params: { threadId: 'thread-a', turn: { id: 'turn-a' } } });
    delta(f, 'terminal synthetic reply');
    f.event({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status } } });
    f.reply(0, { result: { turn: { id: 'turn-a', status } } });
    await expect(pending).resolves.toEqual({ status: 'accepted' });
    expect(f.output.turn).toBeUndefined(); expect(f.conversation.snapshot().canCancel).toBe(false);
    expect(f.conversation.snapshot().messages[0].status).toBe(status);
  }
});

it('keeps a private canonical Fisch mutation failure visible after the Native turn completes', async () => {
  const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  const item = { type: 'mcpToolCall', id: 'tool-a', server: 'fisch_live', tool: 'compose_expression', status: 'failed',
    arguments: { private: 'PRIVATE_TOOL_CANARY' }, error: { message: 'PRIVATE_TOOL_CANARY' }, result: { content: ['PRIVATE_TOOL_CANARY'] } };
  f.event({ method: 'item/completed', params: { threadId: 'thread-a', turnId: 'turn-a', item } });
  f.event({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } } });
  expect(f.conversation.snapshot()).toMatchObject({ canSend: true, error: 'conversation_expression_failed', messages: [] });
  expect(JSON.stringify(f.conversation.snapshot())).not.toContain('PRIVATE_TOOL_CANARY');
  const next = f.send(); expect(f.conversation.snapshot().error).toBe('');
  f.reply(1, { result: { turn: { id: 'turn-b', status: 'inProgress' } } }); await next;
});

it('does not infer expression failure from unrelated, nonterminal, late or foreign tool events', async () => {
  const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  const item = { type: 'mcpToolCall', id: 'tool-a', server: 'fisch_live', tool: 'compose_expression', status: 'failed' };
  const events = [
    { method: 'item/started', params: { threadId: 'thread-a', turnId: 'turn-a', item } },
    ...[{ ...item, server: 'other' }, { ...item, tool: 'observe' }, { ...item, status: 'completed' }].map(item =>
      ({ method: 'item/completed', params: { threadId: 'thread-a', turnId: 'turn-a', item } })),
    { method: 'item/completed', params: { threadId: 'other', turnId: 'turn-a', item } },
    { method: 'item/completed', params: { threadId: 'thread-a', turnId: 'other', item } },
  ];
  for (const event of events) { f.event(event); expect(f.conversation.snapshot().error).toBe(''); }
  f.event({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } } });
  f.event({ method: 'item/completed', params: { threadId: 'thread-a', turnId: 'turn-a', item } });
  expect(f.conversation.snapshot().error).toBe('');
});

it('clears the request-failure notice when a different Native terminal turn owns the conversation', async () => {
  const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  f.event({ method: 'item/completed', params: { threadId: 'thread-a', turnId: 'turn-a',
    item: { type: 'mcpToolCall', id: 'tool-a', server: 'fisch_live', tool: 'express', status: 'failed' } } });
  f.event({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } } });
  expect(f.conversation.snapshot().error).toBe('conversation_expression_failed');
  f.output.request({ id: 'native-next', method: 'turn/start', params: { threadId: 'thread-a' } });
  f.event({ id: 'native-next', result: { turn: { id: 'turn-b', status: 'inProgress' } } });
  expect(f.conversation.snapshot()).toMatchObject({ ownerTurn: 'turn-b', error: '' });
});


it('freezes observation context per send while preserving the original first text', async () => {
  let release, identity;
  const f = fixture({ captureObservation: job => { identity = job; return new Promise(resolve => { release = resolve; }); } });
  const pending = f.send('  exact user text  ');
  expect(f.calls).toHaveLength(0); expect(f.conversation.snapshot().pending).toBe(true);
  await Promise.resolve(); expect(identity).toMatchObject({ thread: 'thread-a', generation: 0 }); expect(Object.isFrozen(identity)).toBe(true);
  release('bounded observation snapshot'); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  expect(f.calls[0].message.params.input).toEqual([{ type:'text',text:'  exact user text  ',text_elements:[] },{ type:'text',text:'bounded observation snapshot',text_elements:[] }]);
  f.reply(0,{result:{turn:{id:'context-turn',status:'completed'}}}); await pending;
});

it.each(['selection','close'])('does not dispatch captured context after %s', async mode => {
  let release; const f = fixture({ captureObservation: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.send(); const rejected = expect(pending).rejects.toThrow('conversation_changed');
  await Promise.resolve(); if(mode==='selection') f.select('thread-b'); else f.conversation.close();
  release('stale context'); await rejected; expect(f.calls).toHaveLength(0);
  expect(f.conversation.snapshot().error).not.toBe('conversation_unknown');
});

it.each(['throw','reject','missing','object','oversize','timeout'])('keeps text chat usable when context is %s', async mode => {
  vi.useFakeTimers();
  try {
    const captureObservation = () => { if(mode==='throw')throw Error('PRIVATE_CAPTURE_ERROR'); if(mode==='reject')return Promise.reject(Error('PRIVATE_CAPTURE_ERROR')); if(mode==='timeout')return new Promise(()=>{}); return mode==='object'?{ text:'untrusted' }:mode==='oversize'?'x'.repeat(8193):null; };
    const f=fixture({captureObservation}), pending=f.send('ordinary text');
    await vi.advanceTimersByTimeAsync(250);
    expect(f.calls).toHaveLength(1); const inputs=f.calls[0].message.params.input;
    expect(inputs[0].text).toBe('ordinary text'); expect(inputs[1].text).toContain('unavailable'); expect(inputs[1].text).not.toContain('PRIVATE');
    f.reply(0,{result:{turn:{id:'fallback-turn',status:'completed'}}}); await pending;
  } finally { vi.useRealTimers(); }
});


it('replaces queued observation context after one second without recapturing', async () => {
  vi.useFakeTimers();
  try {
    const captureObservation=vi.fn(()=> 'fresh geometry'), f=fixture({captureObservation});
    const pending=f.send('unchanged user text'); await vi.advanceTimersByTimeAsync(0);
    const call=f.calls[0]; expect(call.message.params.input[1].text).toBe('fresh geometry');
    await vi.advanceTimersByTimeAsync(1001); expect(call.guard(call.message)).toBe(true);
    expect(call.message.params.input[0].text).toBe('unchanged user text');expect(call.message.params.input[1].text).toContain('unavailable');
    expect(captureObservation).toHaveBeenCalledTimes(1);
    f.reply(0,{result:{turn:{id:'aged-turn',status:'completed'}}});await pending;
  } finally { vi.useRealTimers(); }
});


it.each(['started-first','ack-first'])('hides only owned host context for canonical user items (%s)', async order => {
  const context='machine geometry snapshot', f=fixture({captureObservation:()=>context});
  const pending=f.send('human text'); await vi.waitFor(()=>expect(f.calls).toHaveLength(1));
  if(order==='started-first')f.event({method:'turn/started',params:{threadId:'thread-a',turn:{id:'context-turn'}}});
  else f.reply(0,{result:{turn:{id:'context-turn',status:'inProgress'}}});
  f.event({method:'item/completed',params:{threadId:'thread-a',turnId:'context-turn',item:{id:'owned-user',type:'userMessage',content:[{type:'text',text:'human text'},{type:'text',text:context}]}}});
  expect(f.conversation.snapshot().messages.find(m=>m.id==='owned-user').text).toBe('human text');
  f.event({method:'item/completed',params:{threadId:'thread-a',turnId:'context-turn',item:{id:'ordinary-user',type:'userMessage',content:[{type:'text',text:context}]}}});
  expect(f.conversation.snapshot().messages.find(m=>m.id==='ordinary-user').text).toBe(context);
  f.event({method:'item/completed',params:{threadId:'thread-a',turnId:'context-turn',item:{id:'different-user',type:'userMessage',content:[{type:'text',text:'different human text'},{type:'text',text:context}]}}});
  expect(f.conversation.snapshot().messages.find(m=>m.id==='different-user').text).toBe('different human text\n'+context);
  if(order==='started-first')f.reply(0,{result:{turn:{id:'context-turn',status:'inProgress'}}}); await pending;
});


it('honors the remaining source freshness budget without recapturing', async () => {
  vi.useFakeTimers();
  try {
    // A 1400ms-old snapshot has only 100ms left of the source's 1500ms lifetime.
    const captureObservation=vi.fn(()=>({text:'snapshot aged 1400ms',validForMs:100})), f=fixture({captureObservation});
    const pending=f.send('human question');await vi.advanceTimersByTimeAsync(0);
    const call=f.calls[0];expect(call.message.params.input[1].text).toBe('snapshot aged 1400ms');
    await vi.advanceTimersByTimeAsync(200);expect(call.guard(call.message)).toBe(true);
    expect(call.message.params.input[1].text).toContain('unavailable');expect(captureObservation).toHaveBeenCalledTimes(1);
    f.reply(0,{result:{turn:{id:'aged-source-turn',status:'completed'}}});await pending;
  } finally {vi.useRealTimers();}
});

it.each([0,-1,1001,NaN,Infinity])('rejects expired or invalid context freshness %s', async validForMs => {
  const f=fixture({captureObservation:()=>({text:'unsafe freshness',validForMs})}),pending=f.send();
  await vi.waitFor(()=>expect(f.calls).toHaveLength(1));expect(f.calls[0].message.params.input[1].text).toContain('unavailable');
  f.reply(0,{result:{turn:{id:'invalid-freshness-turn',status:'completed'}}});await pending;
});


it.each(['matching','document','session','revision','missing'])('fences observation at a held user barrier: %s', async change => {
  const scope={documentToken:'document-a',sessionId:'source-a',revision:7};
  const captureObservation=vi.fn(()=>({text:'camera snapshot',validForMs:1000,sourceFence:scope}));
  const f=fixture({captureObservation}),pending=f.send('original human text');await vi.waitFor(()=>expect(f.calls).toHaveLength(1));
  const call=f.calls[0], current=change==='missing'?null:{...scope};
  if(change==='document')current.documentToken='document-b';if(change==='session')current.sessionId='source-b';if(change==='revision')current.revision++;
  // The barrier is held within TTL; a source lifecycle change still revokes old data.
  f.conversation.fenceObservation('unrelated-rpc',null);expect(call.guard(call.message)).toBe(true);expect(call.message.params.input[1].text).toBe('camera snapshot');
  f.conversation.fenceObservation(call.message.id,current);expect(call.guard(call.message)).toBe(true);
  expect(call.message.params.input[0].text).toBe('original human text');
  expect(call.message.params.input[1].text).toEqual(change==='matching'?'camera snapshot':expect.stringContaining('unavailable'));
  if(change!=='matching'){f.conversation.fenceObservation(call.message.id,scope);expect(call.guard(call.message)).toBe(true);expect(call.message.params.input[1].text).toContain('unavailable');}
  expect(captureObservation).toHaveBeenCalledTimes(1);f.reply(0,{result:{turn:{id:'fenced-turn',status:'completed'}}});await pending;
});
