import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';
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
    expect(inputs[0].text).toBe('ordinary text');
    if (['object','oversize'].includes(mode)) { expect(inputs[1].text).toContain('unavailable'); expect(inputs[1].text).not.toContain('PRIVATE'); }
    else expect(inputs).toHaveLength(1);
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

it('shares only confirmed original panel text, bounded Unicode, controls normalized and expiring', async () => {
  let now=100;const f=fixture({now:()=>now,captureObservation:()=> 'MACHINE_CONTEXT_CANARY'});
  const text='a\n\t'+ '😀'.repeat(300), pending=f.send(text);
  expect(f.conversation.observerContext()).toBeNull();await vi.waitFor(()=>expect(f.calls).toHaveLength(1));
  f.event({method:'turn/started',params:{threadId:'thread-a',turn:{id:'observer-turn'}}});
  expect(f.conversation.observerContext()).toBeNull();f.reply(0,{result:{turn:{id:'observer-turn',status:'inProgress'}}});await pending;
  const context=f.conversation.observerContext();expect(context).toMatchObject({threadId:'thread-a',turnId:'observer-turn',ageMs:0});
  expect(Array.from(context.text)).toHaveLength(240);expect(context.text.startsWith('a  ')).toBe(true);expect(Object.isFrozen(context)).toBe(true);
  expect(JSON.stringify(context)).not.toContain('MACHINE_CONTEXT_CANARY');
  f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'observer-turn',status:'completed'}}});
  now+=59999;expect(f.conversation.observerContext().ageMs).toBe(59999);now++;expect(f.conversation.observerContext()).toBeNull();
});

it.each(['selection','thread','navigation','close','cancel','failed','interrupted','unknown'])('revokes confirmed observer context on %s', async reason => {
  const f=fixture(), pending=f.send('confirmed panel text');f.reply(0,{result:{turn:{id:'observer-turn',status:'inProgress'}}});await pending;
  expect(f.conversation.observerContext()).not.toBeNull();
  if(reason==='selection')f.conversation.selectionAttempt();if(reason==='thread')f.select('thread-b');if(reason==='navigation')f.conversation.navigation();if(reason==='close')f.conversation.close();
  if(reason==='cancel'){const cancel=f.conversation.cancel({generation:f.conversation.snapshot().generation});expect(f.conversation.observerContext()).toBeNull();f.reply(1,{result:{}});await cancel;}
  if(['failed','interrupted','unknown'].includes(reason))f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'observer-turn',status:reason}}});
  expect(f.conversation.observerContext()).toBeNull();
});

it.each([false,true])('clears previous context before a new send even if it fails (unknown=%s)', async uncertain => {
  const f=fixture(), first=f.send('previous');f.reply(0,{result:{turn:{id:'first-turn',status:'inProgress'}}});await first;
  f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'first-turn',status:'completed'}}});
  const next=f.send('new text');expect(f.conversation.observerContext()).toBeNull();f.fail(1,uncertain);await expect(next).rejects.toThrow();expect(f.conversation.observerContext()).toBeNull();
});

it('does not restore context from a late ACK after selection or from external user items', async () => {
  const f=fixture(), pending=f.send('stale original');f.conversation.selectionAttempt();
  f.reply(0,{result:{turn:{id:'late-turn',status:'inProgress'}}});await pending;expect(f.conversation.observerContext()).toBeNull();
  f.event({method:'turn/started',params:{threadId:'thread-a',turn:{id:'external-turn'}}});
  f.event({method:'item/completed',params:{threadId:'thread-a',turnId:'external-turn',item:{id:'external',type:'userMessage',content:[{type:'text',text:'not a panel submission'}]}}});
  expect(f.conversation.observerContext()).toBeNull();
});

it('increments observer revisions across confirmed turns and prevents bad terminal before ACK from restoring context', async () => {
  const f=fixture(),first=f.send('first original');f.reply(0,{result:{turn:{id:'first-turn',status:'inProgress'}}});await first;
  const revision=f.conversation.observerContext().revision;
  f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'first-turn',status:'completed'}}});
  const second=f.send('second original');f.reply(1,{result:{turn:{id:'second-turn',status:'inProgress'}}});await second;
  expect(f.conversation.observerContext().revision).toBeGreaterThan(revision);
  f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'second-turn',status:'completed'}}});
  const third=f.send('do not revive');f.event({method:'turn/started',params:{threadId:'thread-a',turn:{id:'third-turn'}}});
  f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'third-turn',status:'failed'}}});
  f.reply(2,{result:{turn:{id:'third-turn',status:'inProgress'}}});await third;expect(f.conversation.observerContext()).toBeNull();
});


it('keeps an owned panel input eligible for context after its guarded RPC is observed', async () => {
  const f=fixture(),pending=f.send('owned panel text');
  f.conversation.inputAttempt(f.calls[0].message);f.reply(0,{result:{turn:{id:'owned-input-turn',status:'inProgress'}}});await pending;
  expect(f.conversation.observerContext()).toMatchObject({text:'owned panel text',turnId:'owned-input-turn'});
});

it.each(['turn/start','turn/steer','turn/interrupt'])('clears confirmed context immediately on external %s input', async method => {
  const f=fixture(),pending=f.send('old confirmed text');f.reply(0,{result:{turn:{id:'old-turn',status:'inProgress'}}});await pending;
  expect(f.conversation.observerContext()).not.toBeNull();
  f.conversation.inputAttempt({id:'external-rpc',method,params:{threadId:'thread-a'}});expect(f.conversation.observerContext()).toBeNull();
});


it.each(['\u0000','\u0000'.repeat(240)+'useful later text'])('does not publish a blank normalized observer brief', async text => {
  const f=fixture(),pending=f.send(text);f.reply(0,{result:{turn:{id:'empty-brief-turn',status:'inProgress'}}});await pending;
  expect(f.conversation.observerContext()).toBeNull();
});


it('does not let a late old failed terminal erase a newer confirmed context', async () => {
  const f=fixture(),old=f.send('old turn');f.reply(0,{result:{turn:{id:'old-completed-ack',status:'completed'}}});await old;
  const next=f.send('new turn');f.reply(1,{result:{turn:{id:'new-confirmed-turn',status:'inProgress'}}});await next;
  const context=f.conversation.observerContext();
  f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'old-completed-ack',status:'failed'}}});
  expect(f.conversation.observerContext()).toMatchObject({revision:context.revision,turnId:'new-confirmed-turn',text:'new turn'});
});
it('uses a strict same-frame read-only observer authorization action without a new Native turn',async()=>{
 let binding;const frame={url:()=> 'http://127.0.0.1:123/live.html'},page={url:frame.url,mainFrame:()=>frame,isClosed:()=>false,on(){},off(){},exposeBinding:async(_name,fn)=>{binding=fn;}};
 const calls=[],dispose=await bindLiveConversation(page,{authorizeObserverContext:id=>{calls.push(id);return id==='r';},navigation(){}});
 expect(binding({page,frame},{action:'authorize_observer_context',requestId:'r'})).toBe(true);
 expect(binding({page,frame},{action:'authorize_observer_context',requestId:'other'})).toBe(false);
 expect(()=>binding({page,frame},{action:'authorize_observer_context',requestId:'r',text:'PRIVATE'})).toThrow('source_rejected');
 expect(()=>binding({page,frame:{url:frame.url}},{action:'authorize_observer_context',requestId:'r'})).toThrow('source_rejected');
 expect(calls).toEqual(['r','other']);dispose();
});
it('revokes confirmed observer context on transport loss and preserves its error after delayed send rejection',async()=>{
 const f=fixture(),sent=f.send('Public current question');f.reply(0,{result:{turn:{id:'turn-a',status:'inProgress'}}});await sent;
 expect(f.conversation.observerContext().text).toBe('Public current question');delta(f,'Public partial');f.conversation.transportLost();
 expect(f.conversation.observerContext()).toBeNull();expect(f.conversation.snapshot()).toMatchObject({available:false,canSend:false,error:'conversation_transport_lost',messages:[{text:'Public partial',status:'unknown'}]});
 const g=fixture(),pending=g.send('Do not resend');g.event({method:'turn/started',params:{threadId:'thread-a',turn:{id:'turn-a'}}});delta(g,'Pending partial');g.conversation.transportLost();g.fail(0,true);
 await expect(pending).rejects.toThrow('conversation_unknown');expect(g.conversation.snapshot()).toMatchObject({error:'conversation_transport_lost',messages:[{text:'Pending partial',status:'unknown'}]});expect(g.calls).toHaveLength(1);
});


it('shares only a canonical completed final answer, bounded and revision-fenced with a fresh completion TTL', async () => {
  let now=100; const f=fixture({now:()=>now}), pending=f.send('Snack or a quiet break?');
  f.reply(0,{result:{turn:{id:'reply-turn',status:'inProgress'}}});await pending;
  const before=f.conversation.observerContext();
  const item=(phase,text,id='answer')=>f.event({method:'item/completed',params:{threadId:'thread-a',turnId:'reply-turn',item:{type:'agentMessage',id,phase,text}}});
  item('commentary','PRIVATE_PARTIAL');expect(f.conversation.observerContext().assistantReply).toBeUndefined();
  item('final_answer','Public answer\n'+'a'.repeat(500));expect(f.conversation.observerContext().assistantReply).toBeUndefined();
  now=200;f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'reply-turn',status:'completed'}}});
  const context=f.conversation.observerContext();expect(context.revision).toBeGreaterThan(before.revision);expect(context.ageMs).toBe(0);
  expect(context.assistantReply).toMatchObject({messageId:'answer',truncated:true});expect(Array.from(context.assistantReply.text)).toHaveLength(480);
  expect(context.assistantReply.text).not.toContain('\n');expect(Object.isFrozen(context.assistantReply)).toBe(true);
  now=60200;expect(f.conversation.observerContext()).toBeNull();item('final_answer','late');expect(f.conversation.observerContext()).toBeNull();
});
it.each(['failed','interrupted','delta-only','other-thread'])('does not share %s as a completed MAIN answer',async kind=>{
  const f=fixture(),pending=f.send('Public user');f.reply(0,{result:{turn:{id:'reply-turn',status:'inProgress'}}});await pending;
  if(kind==='delta-only')delta(f,'Partial','answer','reply-turn');
  else f.event({method:'item/completed',params:{threadId:kind==='other-thread'?'other':'thread-a',turnId:'reply-turn',item:{type:'agentMessage',id:'answer',phase:'final_answer',text:'Not confirmed'}}});
  f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'reply-turn',status:['failed','interrupted'].includes(kind)?kind:'completed'}}});
  expect(f.conversation.observerContext()?.assistantReply).toBeUndefined();
});

it('attaches a completed final answer when terminal notification precedes the submit ACK',async()=>{
 const f=fixture(),pending=f.send('Public user');
 f.event({method:'turn/started',params:{threadId:'thread-a',turn:{id:'early-turn'}}});
 f.event({method:'item/completed',params:{threadId:'thread-a',turnId:'early-turn',item:{type:'agentMessage',id:'final',phase:'final_answer',text:'Public final'}}});
 f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'early-turn',status:'completed'}}});
 expect(f.conversation.observerContext()).toBeNull();f.reply(0,{result:{turn:{id:'early-turn',status:'completed'}}});await pending;
 expect(f.conversation.observerContext().assistantReply).toEqual({messageId:'final',text:'Public final',truncated:false});
 f.select('other');expect(f.conversation.observerContext()).toBeNull();
});

it('omits a final answer whose bounded excerpt contains only whitespace',async()=>{
 const f=fixture(),pending=f.send('Public user');f.reply(0,{result:{turn:{id:'space-turn',status:'inProgress'}}});await pending;
 f.event({method:'item/completed',params:{threadId:'thread-a',turnId:'space-turn',item:{type:'agentMessage',id:'spaces',phase:'final_answer',text:' '.repeat(480)+'outside excerpt'}}});
 f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'space-turn',status:'completed'}}});
 expect(f.conversation.observerContext().text).toBe('Public user');expect(f.conversation.observerContext().assistantReply).toBeUndefined();
});

const expressionItem = (status, receipt = { status: 'accepted', session: 's', epoch: 'e', seq: 1, requestId: 'r' }) => ({
  type: 'mcpToolCall', id: 'retry', server: 'fisch_live', tool: 'compose_expression', status,
  error: null, result: { content: [{ type: 'text', text: JSON.stringify(receipt) }] },
});
async function failedExpression(tool = 'compose_expression') {
  const f = fixture(), pending = f.send(); f.reply(0, { result: { turn: { id: 'turn-a', status: 'inProgress' } } }); await pending;
  const item = { ...expressionItem('failed'), tool, id: 'failure', error: { message: 'PRIVATE_FAILURE' } };
  const original = structuredClone(item);
  f.event({ method: 'item/completed', params: { threadId: 'thread-a', turnId: 'turn-a', item } });
  return { ...f, failureItem: item, original, tool: (item, completed = true, threadId = 'thread-a', turnId = 'turn-a') =>
    f.event({ method: completed ? 'item/completed' : 'item/started', params: { threadId, turnId, item } }) };
}
it('clears only the current warning after a later accepted expression retry, preserving canonical failure evidence', async () => {
  for (const tool of ['compose_expression', 'express', 'return_to_face']) {
    const f = await failedExpression(); f.tool({ ...expressionItem('inProgress'), tool }, false);
    f.tool({ ...expressionItem('completed'), tool });
    expect(f.conversation.snapshot().error).toBe(''); expect(f.failureItem).toEqual(f.original);
    expect(JSON.stringify(f.conversation.snapshot())).not.toContain('PRIVATE_FAILURE');
    f.event({ method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'completed' } } });
    expect(f.conversation.snapshot()).toMatchObject({ canSend: true, error: '' });
  }
});
it('keeps unrecovered failure visible for pending, rejected, malformed and errored retry receipts', async () => {
  for (const item of [expressionItem('failed'), expressionItem('completed', { status: 'pending' }),
    expressionItem('completed', { status: 'rejected' }), expressionItem('completed', { status: 'accepted' }),
    { ...expressionItem('completed'), error: { message: 'failed' } },
    { ...expressionItem('completed'), result: { isError: true, content: expressionItem('completed').result.content } },
    { ...expressionItem('completed'), result: { content: [{ type: 'text', text: '{bad' }] } }]) {
    const f = await failedExpression(); f.tool(expressionItem('inProgress'), false); f.tool(item);
    expect(f.conversation.snapshot().error).toBe('conversation_expression_failed');
  }
});
it('does not treat older, unrelated or foreign successful tool events as recovery', async () => {
  const f = await failedExpression(); f.tool(expressionItem('completed'));
  expect(f.conversation.snapshot().error).toBe('conversation_expression_failed');
  for (const tool of ['preview_expression', 'observe', 'cancel_expression']) {
    f.tool({ ...expressionItem('inProgress'), tool }, false); f.tool({ ...expressionItem('completed'), tool });
  }
  f.tool(expressionItem('inProgress'), false, 'foreign'); f.tool(expressionItem('completed'));
  f.tool(expressionItem('inProgress'), false, 'thread-a', 'foreign'); f.tool(expressionItem('completed'));
  expect(f.conversation.snapshot().error).toBe('conversation_expression_failed');
});
it('shows a new failure again after successful retry rather than hiding all subsequent errors', async () => {
  const f = await failedExpression(); f.tool(expressionItem('inProgress'), false); f.tool(expressionItem('completed'));
  expect(f.conversation.snapshot().error).toBe('');
  f.tool({ ...expressionItem('failed'), id: 'second-failure' });
  expect(f.conversation.snapshot().error).toBe('conversation_expression_failed');
});

const committedPlayground = { status: 'committed', revision: 1, scenes: 1, closed: false, bytes: 3494, pending: null, recoveryRequired: false };
it('clears warning after a later same-turn committed playground edit and keeps failure evidence', async () => {
  const f = await failedExpression('playground_edit'), item = { ...expressionItem('completed', committedPlayground), tool: 'playground_edit' };
  f.tool(item); expect(f.conversation.snapshot().error).toBe('conversation_expression_failed');
  f.tool({ ...item, status: 'inProgress' }, false); f.tool(item);
  expect(f.conversation.snapshot().error).toBe(''); expect(f.failureItem).toEqual(f.original);
});
it('does not clear warnings for failed or unresolved playground edits', async () => {
  for (const patch of [{status:'rejected'}, {status:'pending'}, {pending:{stage:'pending'}}, {recoveryRequired:true},
    {closed:true}, {revision:0}, {scenes:0}, {scenes:13}, {bytes:-1}, {code:'playground_scene'}]) {
    const f = await failedExpression('playground_edit');
    const item = { ...expressionItem('completed', {...committedPlayground,...patch}), tool:'playground_edit' };
    f.tool({...item,status:'inProgress'},false); f.tool(item);
    expect(f.conversation.snapshot().error).toBe('conversation_expression_failed');
  }
  for (const status of ['failed','completed']) {
    const f = await failedExpression('playground_edit'), item = {...expressionItem(status,committedPlayground),tool:'playground_edit'};
    if(status==='completed')item.result.isError=true;
    f.tool({...item,status:'inProgress'},false);f.tool(item);expect(f.conversation.snapshot().error).toBe('conversation_expression_failed');
  }
});

function completeReply(f, turn='reply-turn') {
 f.event({method:'item/completed',params:{threadId:'thread-a',turnId:turn,item:{type:'agentMessage',id:'final',phase:'final_answer',text:'Public completed answer'}}});
 f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:turn,status:'completed'}}});
}
it.each([39000,75000])('refreshes context once at final completion after %sms, not from reads',async elapsed=>{
 let now=0;const f=fixture({now:()=>now}),pending=f.send('Public user');f.reply(0,{result:{turn:{id:'reply-turn',status:'inProgress'}}});await pending;
 const original=f.conversation.observerContext();now=elapsed;
 if(elapsed>=60000)expect(f.conversation.observerContext()).toBeNull();
 completeReply(f);const final=f.conversation.observerContext();expect(final.ageMs).toBe(0);expect(final.revision).toBeGreaterThan(original.revision);
 expect(final.text).toBe(original.text);expect(final).not.toHaveProperty('at');expect(final).not.toHaveProperty('replyAt');
 now+=35000;expect(f.conversation.observerContext().ageMs).toBe(35000);completeReply(f);
 expect(f.conversation.observerContext().ageMs).toBe(35000);expect(f.conversation.observerContext().revision).toBe(final.revision);
 now+=25000;expect(f.conversation.observerContext()).toBeNull();completeReply(f);expect(f.conversation.observerContext()).toBeNull();
});
it.each(['next-input','next-turn','thread','transport','close','failed','rollback'])('does not revive expired context after %s invalidation',async reason=>{
 let now=0;const f=fixture({now:()=>now}),pending=f.send('Public user');f.reply(0,{result:{turn:{id:'reply-turn',status:'inProgress'}}});await pending;
 now=65000;expect(f.conversation.observerContext()).toBeNull();
 if(reason==='next-input')f.conversation.inputAttempt({id:'other',method:'turn/start'});
 else if(reason==='next-turn')f.event({method:'turn/started',params:{threadId:'thread-a',turn:{id:'new-turn'}}});
 else if(reason==='thread')f.select('other');else if(reason==='transport')f.conversation.transportLost();else if(reason==='close')f.conversation.close();
 else if(reason==='failed')f.event({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'reply-turn',status:'failed'}}});
 else {now=-1;expect(f.conversation.observerContext()).toBeNull();now=65000;}
 completeReply(f);expect(f.conversation.observerContext()).toBeNull();
});

it('fences old in-flight observer context when the completed reply renews freshness',async()=>{
 let now=0;const f=fixture({now:()=>now}),pending=f.send('Public user');f.reply(0,{result:{turn:{id:'reply-turn',status:'inProgress'}}});await pending;
 const old={hostCapabilities:{currentTurnContext:f.conversation.observerContext()}};
 const broker=new LiveReactiveBroker({page:{},provider:{conversationLane:true},output:{},forward(){},reject(){},contextSource:()=>f.conversation.observerContext()});
 expect(broker.sharedContextCurrent(old)).toBe(true);now=39000;completeReply(f);
 expect(broker.sharedContextCurrent(old)).toBe(false);
 const fresh={hostCapabilities:{currentTurnContext:f.conversation.observerContext()}};now=78000;
 expect(broker.sharedContextCurrent(fresh)).toBe(true);f.conversation.inputAttempt({method:'turn/start',id:'next'});
 expect(broker.sharedContextCurrent(fresh)).toBe(false);broker.close();
});

const cameraUrl = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]).toString('base64');
const cameraContext = () => ({text:'Camera snapshot metadata', validForMs:1000, image:{type:'image',url:cameraUrl},sourceFence:{documentToken:'doc-a',sessionId:'camera-a',revision:1}});
it.each(['matching','revoked','expired'])('forwards real image input only while valid: %s',async mode=>{
 vi.useFakeTimers();try {
  const f=fixture({captureObservation:cameraContext}),pending=f.send('  alo  ');await vi.advanceTimersByTimeAsync(0);
  const call=f.calls[0];expect(call.message.params.input[2]).toEqual({type:'image',url:cameraUrl});
  if(mode==='revoked')f.conversation.fenceObservation(call.message.id,null);
  if(mode==='expired')await vi.advanceTimersByTimeAsync(1001);
  expect(call.guard(call.message)).toBe(true);expect(call.message.params.input[0].text).toBe('  alo  ');
  expect(call.message.params.input).toHaveLength(mode==='matching'?3:1);
  f.reply(0,{result:{turn:{id:'image-turn',status:'completed'}}});await pending;
  f.event({method:'item/completed',params:{threadId:'thread-a',turnId:'image-turn',item:{id:'image-user',type:'userMessage',content:call.message.params.input}}});
  expect(JSON.stringify(f.conversation.snapshot())).not.toContain(cameraUrl);
  expect(JSON.stringify(f.conversation.observerContext())).not.toContain(cameraUrl);
 }finally{vi.useRealTimers();}
});
it.each(['missing-fence','bad-image'])('omits unsafe camera enrichment: %s',async mode=>{
 const value=cameraContext();if(mode==='missing-fence')delete value.sourceFence;else value.image.url='data:image/jpeg;base64,AAAA';
 const f=fixture({captureObservation:()=>value}),pending=f.send('alo');await vi.waitFor(()=>expect(f.calls).toHaveLength(1));
 expect(f.calls[0].message.params.input).toEqual([{type:'text',text:'alo',text_elements:[]}]);
 f.reply(0,{result:{turn:{id:'image-turn',status:'completed'}}});await pending;
});

it.each(['selection','thread','navigation','close'])('does not forward a held camera image after %s',async mode=>{
 const f=fixture({captureObservation:cameraContext}),pending=f.send('alo');await vi.waitFor(()=>expect(f.calls).toHaveLength(1));
 const call=f.calls[0];expect(call.message.params.input[2].type).toBe('image');
 if(mode==='selection')f.conversation.selectionAttempt();if(mode==='thread')f.select('different-thread');
 if(mode==='navigation')f.conversation.navigation();if(mode==='close')f.conversation.close();
 expect(call.guard(call.message)).toBe(false);
 f.fail(0,false);await expect(pending).rejects.toThrow();
});
