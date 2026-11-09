import { expect, it, vi } from 'vitest';
import { LiveChat, bindLiveChat } from '../integrations/live-chat.mjs';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { openCodexTransport, LiveRequests } from '../integrations/live-codex-transport.mjs';
import { LiveOutput } from '../integrations/live-output.mjs';
import { LiveReactivity } from '../integrations/live-reactivity.mjs';

function setup() {
  const writes = [], output = new LiveOutput(); output.thread = 'thread';
  const rpc = new LiveRequests(message => writes.push(message));
  let chat;
  const event = message => { output.accept(message); chat.accept(message); reactor.event(message); };
  const transport = { request: (method, params) => rpc.request(method, params),
    submitUser: (params, guard, discard) => rpc.request('turn/start', params, { guard, observe: event, discard,
      dispatch: message => { if (!guard()) throw Error('stale'); if (reactor.client(message) !== false) rpc.forward(message); } }) };
  const reactor = new LiveReactivity({ output, request: transport.request, forward: message => rpc.forward(message),
    reject: (message, error) => rpc.rejectOwned(message, error) });
  chat = new LiveChat({ output, transport, reactor }); chat.sync();
  const respond = async message => { await rpc.observe(message); const outgoing = rpc.accept(message); if (outgoing !== false) event(outgoing); };
  return { chat, rpc, output, reactor, writes, respond, event, close: () => { chat.close(); reactor.close(); rpc.close(); } };
}
function send(f, text = 'Hello') { return f.chat.send({ text, generation: f.chat.generation }); }
function start(f, id = 'turn') { f.event({ method: 'turn/started', params: { threadId: 'thread', turn: { id } } }); }
function complete(f, id = 'turn', status = 'completed') {
  f.event({ method: 'turn/completed', params: { threadId: 'thread', turn: { id, status } } });
}
function delta(f, text, id = 'agent') {
  f.event({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'turn', itemId: id, delta: text } });
}

it('submits genuine user text through arbitration in the selected thread and observes its actual reply', async () => {
  const f = setup();
  try {
    const sent = send(f); expect(f.reactor.userRequests.size).toBe(1);
    expect(f.writes[0].params).toEqual({ threadId: 'thread', input: [{ type: 'text', text: 'Hello', text_elements: [] }] });
    await expect(send(f)).rejects.toThrow('chat_not_ready');
    await f.respond({ id: f.writes[0].id, result: { turn: { id: 'turn' } } });
    await expect(sent).resolves.toEqual({ status: 'accepted' });
    expect(f.reactor.userRequests.size).toBe(0); expect(f.reactor.userTurns.has('turn')).toBe(true);
  } finally { f.close(); }
});
it('preempts a reactive turn and forwards the original request once only after confirmed completion', async () => {
  const f = setup();
  try {
    f.reactor.active = { threadId: 'thread', turnId: 'reaction' }; f.reactor.reactionThread = 'thread';
    start(f, 'reaction'); const sent = send(f);
    expect(f.writes.map(item => item.method)).toEqual(['turn/interrupt']);
    await f.respond({ id: f.writes[0].id, result: {} }); complete(f, 'reaction');
    expect(f.writes.map(item => item.method)).toEqual(['turn/interrupt', 'turn/start']);
    await f.respond({ id: f.writes[1].id, result: { turn: { id: 'turn' } } }); await sent;
    f.reactor.flush(); expect(f.writes.length).toBe(2);
  } finally { f.close(); }
});
it('rejects a queued message after thread selection without forwarding it to the former thread', async () => {
  const f = setup();
  try {
    f.reactor.active = { threadId: 'thread', turnId: 'reaction' }; f.reactor.reactionThread = 'thread'; start(f, 'reaction');
    const sent = send(f); const rejected = expect(sent).rejects.toThrow('Chat session changed');
    f.chat.selection(); f.output.request({ id: 99, method: 'thread/resume' });
    await f.respond({ id: f.writes[0].id, result: {} }); complete(f, 'reaction'); await rejected;
    expect(f.writes.map(item => item.method)).toEqual(['turn/interrupt']); expect(f.reactor.userRequests.size).toBe(0);
  } finally { f.close(); }
});
it('never forwards expired queued requests and treats sent timeout as unknown without retry', async () => {
  vi.useFakeTimers(); const f = setup();
  try {
    const sent = send(f), rejected = expect(sent).rejects.toThrow('outcome unknown');
    await vi.advanceTimersByTimeAsync(10001); await rejected;
    expect(f.chat.snapshot().canSend).toBe(false); expect(f.writes).toHaveLength(1);
    expect(() => f.rpc.forward(f.writes[0])).toThrow('chat_session_changed');
  } finally { f.close(); vi.useRealTimers(); }
});
it('handles real rejection, completion before acknowledgment and transport closure', async () => {
  const f = setup();
  try {
    const rejected = send(f), assertion = expect(rejected).rejects.toThrow('not accepted');
    await f.respond({ id: f.writes[0].id, error: { code: -1 } }); await assertion;
    const next = send(f); start(f); complete(f);
    await f.respond({ id: f.writes[1].id, result: { turn: { id: 'turn' } } }); await next;
    expect(f.reactor.userTurns.size).toBe(0); expect(f.chat.active).toBeUndefined();
    const closed = send(f), closing = expect(closed).rejects.toThrow(); f.rpc.close(); await closing;
  } finally { f.close(); }
});
it('projects actual user and assistant text, reconciles completion, ignores tools, reasoning and stale turns', () => {
  const f = setup();
  try {
    start(f);
    f.event({ method: 'item/started', params: { threadId: 'thread', turnId: 'turn', item: { type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'Hello' }] } } });
    delta(f, 'Hi'); delta(f, ' there');
    f.event({ method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item: { type: 'agentMessage', id: 'agent', text: 'Hi there!' } } });
    f.event({ method: 'item/reasoning/textDelta', params: { threadId: 'thread', turnId: 'turn', delta: 'secret' } });
    f.event({ method: 'item/agentMessage/delta', params: { threadId: 'other', turnId: 'turn', itemId: 'bad', delta: 'stale' } });
    expect(f.chat.messages.map(item => item.text)).toEqual(['Hello', 'Hi there!']);
    complete(f, 'turn', 'interrupted'); delta(f, 'late'); expect(f.chat.messages[1].status).toBe('interrupted');
    expect(f.chat.messages[1].text).toBe('Hi there!');
  } finally { f.close(); }
});
it('bounds transcript count and bytes, clears on selected-thread change, rejects empty and oversized input', async () => {
  const f = setup();
  try {
    await expect(send(f, ' ')).rejects.toThrow('chat_invalid_text'); await expect(send(f, 'x'.repeat(16001))).rejects.toThrow('chat_invalid_text');
    start(f); delta(f, 'x'.repeat(70000)); expect(f.chat.messages[0].text.length).toBe(64000); expect(f.chat.messages[0].truncated).toBe(true);
    for (let i = 0; i < 100; i++) delta(f, 'x'.repeat(5000), 'a' + i);
    expect(f.chat.messages.length).toBeLessThanOrEqual(80);
    expect(f.chat.messages.reduce((n, item) => n + item.text.length, 0)).toBeLessThanOrEqual(128000);
    f.output.thread = 'other'; expect(f.chat.snapshot().messages).toEqual([]);
  } finally { f.close(); }
});
it('cancels the captured active turn without claiming completion and exposes terminal approval status', async () => {
  const f = setup();
  try {
    start(f); f.output.state = 'waiting'; expect(f.chat.snapshot().waiting).toBe(true);
    const stopped = f.chat.cancel({ generation: f.chat.generation });
    expect(f.writes[0].params).toEqual({ threadId: 'thread', turnId: 'turn' });
    await f.respond({ id: f.writes[0].id, result: {} }); await stopped;
    expect(f.chat.snapshot().stopping).toBe(true); complete(f); expect(f.chat.snapshot().stopping).toBe(false);
  } finally { f.close(); }
});
it('exposed binding rejects subframes, unexpected pages, navigation and unsupported operations', async () => {
  let binding; const frame = { url: () => 'http://127.0.0.1:123/live.html' };
  const page = { url: frame.url, mainFrame: () => frame, isClosed: () => false, exposeBinding: async (_name, callback) => { binding = callback; } };
  const send = vi.fn(() => 'accepted'), chat = { send }; await bindLiveChat(page, chat);
  expect(binding({ page, frame }, { action: 'send', text: 'hi' })).toBe('accepted');
  expect(() => binding({ page, frame: { url: frame.url } }, { action: 'send' })).toThrow('chat_source_rejected');
  expect(() => binding({ page: {}, frame }, { action: 'send' })).toThrow('chat_source_rejected');
  expect(() => binding({ page, frame }, { action: 'turn/start' })).toThrow('chat_source_rejected');
  frame.url = () => 'http://127.0.0.1:123/other';
  expect(() => binding({ page, frame }, { action: 'send' })).toThrow('chat_source_rejected'); expect(send).toHaveBeenCalledTimes(1);
});

it('the real relay routes browser acknowledgments to observers only while terminal notifications still stream', async () => {
  const script = `let b='';process.stdin.on('data',c=>{b+=c;let n;while((n=b.indexOf('\\n'))>=0){let m=JSON.parse(b.slice(0,n));b=b.slice(n+1);process.stdout.write(JSON.stringify({id:m.id,result:{turn:{id:'real-fixture'}}})+'\\n'+JSON.stringify({method:'turn/started',params:{threadId:m.params.threadId,turn:{id:'real-fixture'}}})+'\\n')}})`;
  const events = [], requests = [];
  const transport = await openCodexTransport({ host: { command: process.execPath, args: ['-e', script, '--'] }, args: [],
    cwd: process.cwd(), env: process.env, instructions: '', onEvent: message => events.push(message), onRequest: message => requests.push(message) });
  const socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } });
  try {
    await once(socket, 'open'); const received = once(socket, 'message');
    const response = await transport.submitUser({ threadId: 'same', input: [{ type: 'text', text: 'hi' }] }, () => true);
    expect(response.result.turn.id).toBe('real-fixture'); expect(requests[0].params.threadId).toBe('same');
    const [bytes] = await received; expect(JSON.parse(bytes.toString()).method).toBe('turn/started');
    expect(events[0]).toEqual(response); expect(events[1].method).toBe('turn/started');
  } finally { socket.terminate(); await transport.close(); }
});
it('keeps typing disabled until a user turn acknowledged before its start notification finishes', async () => {
  const f = setup();
  try {
    const sent = send(f); await f.respond({ id: f.writes[0].id, result: { turn: { id: 'turn' } } }); await sent;
    expect(f.chat.snapshot().canSend).toBe(false); await expect(send(f)).rejects.toThrow('chat_not_ready');
    start(f); complete(f); expect(f.chat.snapshot().canSend).toBe(true);
  } finally { f.close(); }
});

it('cleans up arbitration after local write failure and timeout, allowing completion or new selection to recover', async () => {
  vi.useFakeTimers(); const f = setup();
  try {
    const original = f.rpc.write; f.rpc.write = () => { throw Error('relay_unavailable'); };
    await expect(send(f)).rejects.toThrow('not accepted'); expect(f.reactor.userRequests.size).toBe(0);
    expect(f.chat.snapshot().canSend).toBe(true); f.rpc.write = original;
    const sent = send(f), rejected = expect(sent).rejects.toThrow('outcome unknown');
    await vi.advanceTimersByTimeAsync(10001); await rejected; expect(f.reactor.userRequests.size).toBe(0);
    start(f); complete(f); expect(f.chat.snapshot().canSend).toBe(true); expect(f.chat.error).toBe('');
    const again = send(f), timedOut = expect(again).rejects.toThrow('outcome unknown');
    await vi.advanceTimersByTimeAsync(10001); await timedOut;
    f.chat.selection(); f.output.thread = 'new'; expect(f.chat.snapshot().canSend).toBe(true);
  } finally { f.close(); vi.useRealTimers(); }
});

it('expires an unsent reactive-queue message without replaying it after cancellation completes', async () => {
  vi.useFakeTimers(); const f = setup();
  try {
    f.reactor.active = { threadId: 'thread', turnId: 'reaction' }; f.reactor.reactionThread = 'thread'; start(f, 'reaction');
    const sent = send(f), rejected = expect(sent).rejects.toThrow('not accepted');
    await vi.advanceTimersByTimeAsync(10001); await rejected;
    expect(f.chat.uncertain).toBe(false); expect(f.reactor.userRequests.size).toBe(0);
    complete(f, 'reaction'); expect(f.writes.map(item => item.method)).toEqual(['turn/interrupt']);
    expect(f.reactor.queued).toEqual([]); expect(f.chat.snapshot().canSend).toBe(true);
  } finally { f.close(); vi.useRealTimers(); }
});
