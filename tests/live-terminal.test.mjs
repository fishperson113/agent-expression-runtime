import { presentationCall } from '../integrations/live-terminal.mjs';
import { expect, it } from 'vitest';
import { selectLiveHost } from '../scripts/live-session.mjs';
import { LiveOutput } from '../integrations/live-output.mjs';
import { openCodexTransport, scopedLiveRequest } from '../integrations/live-codex-transport.mjs';
import { WebSocket } from 'ws';
import { once } from 'node:events';

it('uses the current workspace without contacting Herdr when it is absent', async () => {
  const host = await selectLiveHost({ env: {}, cwd: '/tmp/workspace', call: () => { throw Error('must not call Herdr'); } });
  expect(host).toEqual({ kind: 'terminal', cwd: '/tmp/workspace' });
});
it('preserves native thread instructions without adding visual context', () => {
  const input = { id: 1, method: 'thread/start', params: { developerInstructions: 'Keep existing policy.' } };
  const result = scopedLiveRequest(input, '/fisch', 'Use your body.');
  expect(result.params.developerInstructions).toContain('Keep existing policy.');
  expect(result.params.developerInstructions).toBe('Keep existing policy.');
  expect(scopedLiveRequest(result, '/fisch', 'Use your body.')).toEqual(result);
  expect(input.params.developerInstructions).toBe('Keep existing policy.');
});
it('authenticates the owned relay and carries stdio messages without copying credentials into arguments', async () => {
  const script = `let b='';process.stdin.on('data',c=>{b+=c;let n;while((n=b.indexOf('\\n'))>=0){let m=JSON.parse(b.slice(0,n));b=b.slice(n+1);process.stdout.write(JSON.stringify({id:m.id,result:{...m.params,pid:process.pid}})+'\\n')}})`;
  const requests = [];
  const transport = await openCodexTransport({ host: { command: process.execPath, args: ['-e', script, '--'] }, args: [],
    cwd: process.cwd(), env: process.env, instructions: 'Live instructions', onRequest: message => requests.push(message.method) });
  let socket, pid;
  try {
    const rejected = new WebSocket(transport.url);
    await expect(once(rejected, 'open')).rejects.toThrow('403');
    socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } });
    await once(socket, 'open');
    const response = once(socket, 'message');
    socket.send(JSON.stringify({ id: 1, method: 'thread/start', params: { cwd: '/tmp/workspace' } }));
    const [bytes] = await response;
    pid = JSON.parse(bytes.toString()).result.pid;
    expect(JSON.parse(bytes.toString()).result.developerInstructions).toBeUndefined();
    expect(requests).toEqual(['thread/start']);
    expect(transport.url).not.toContain(transport.token);
  } finally { socket?.terminate(); await transport.close(); }
  expect(() => process.kill(pid, 0)).toThrow();
});
it('distinguishes actual assistant deltas from tool output and stale turns', () => {
  const stream = new LiveOutput();
  stream.accept({ method: 'turn/started', params: { threadId: 't', turn: { id: 'a' } } }, 0);
  stream.accept({ method: 'item/commandExecution/outputDelta', params: { threadId: 't', turnId: 'a', delta: 'tool output' } }, 10);
  expect(stream.sample(20).output).toBe(0);
  stream.accept({ method: 'item/agentMessage/delta', params: { threadId: 't', turnId: 'old', delta: 'stale' } }, 30);
  expect(stream.sample(40).output).toBe(0);
  stream.accept({ method: 'turn/started', params: { threadId: 'other', turn: { id: 'b' } } }, 50);
  stream.accept({ method: 'item/agentMessage/delta', params: { threadId: 't', turnId: 'a', delta: 'Hello' } }, 100);
  expect(stream.sample(110).output).toBeGreaterThan(0);
  expect(stream.sample(700).output).toBe(0);
  stream.accept({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'a', status: 'completed' } } }, 710);
  expect(stream.sample(710).turn).toBe('idle');
});
it('switches output tracking only after the UI selects a thread successfully', () => {
  const selected = [], stream = new LiveOutput(thread => selected.push(thread));
  stream.accept({ method: 'turn/started', params: { threadId: 'old', turn: { id: 'a' } } }, 0);
  stream.request({ id: 7, method: 'thread/start' });
  stream.accept({ method: 'thread/started', params: { thread: { id: 'background' } } }, 1);
  expect(stream.thread).toBe('old');
  stream.accept({ id: 7, result: { thread: { id: 'new' } } }, 2);
  expect(stream.sample(2).turn).toBe('idle');
  stream.accept({ method: 'turn/started', params: { threadId: 'new', turn: { id: 'b' } } }, 3);
  stream.accept({ method: 'item/agentMessage/delta', params: { threadId: 'old', turnId: 'a', delta: 'stale' } }, 4);
  expect(stream.sample(4).output).toBe(0);
  stream.accept({ method: 'item/agentMessage/delta', params: { threadId: 'new', turnId: 'b', delta: 'reply' } }, 5);
  expect(stream.sample(5).output).toBeGreaterThan(0);
  stream.request({ id: 8, method: 'thread/resume' });
  stream.accept({ id: 8, error: { code: -1 } }, 6);
  expect(stream.thread).toBe('new');
  stream.request({ id: 9, method: 'thread/resume' });
  stream.request({ id: 10, method: 'thread/fork' });
  stream.accept({ id: 9, result: { thread: { id: 'superseded' } } }, 7);
  expect(stream.thread).toBe('new');
  stream.accept({ id: 10, result: { thread: { id: 'fork' } } }, 8);
  expect(stream.thread).toBe('fork');
  expect(selected).toEqual(['new', 'fork']);
});
it('waits for controller handoff before forwarding selection and following events', async () => {
  const script = `process.stdin.on('data',()=>process.stdout.write('{"id":1,"result":{"thread":{"id":"new"}}}\\n{"method":"following"}\\n'))`;
  let release, entered;
  const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const transport = await openCodexTransport({ host: { command: process.execPath, args: ['-e', script, '--'] }, args: [],
    cwd: process.cwd(), env: process.env, instructions: '', onEvent: async message => { if (message.id === 1) { entered(); await blocked; } } });
  const socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } }), messages = [];
  try {
    await once(socket, 'open'); socket.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
    socket.send('{"id":1,"method":"thread/start","params":{}}'); await started;
    expect(messages).toEqual([]);
    const received = once(socket, 'message'); release(); await received;
    await new Promise(resolve => setImmediate(resolve));
    expect(messages.map(message => message.id ?? message.method)).toEqual([1, 'following']);
  } finally { release(); socket.terminate(); await transport.close(); }
});

it('uses the current terminal relay inside Herdr unless a legacy pane is explicit', async () => {
  const env = { HERDR_PANE_ID: 'shell', HERDR_SOCKET_PATH: 'local-socket' };
  const host = await selectLiveHost({ env, cwd: '/project', call: () => { throw Error('must not inspect other panes'); } });
  expect(host).toEqual({ kind: 'terminal', cwd: '/project' });
  const legacy = await selectLiveHost({ env, agentPane: 'legacy', call: async () => ({
    snapshot: { agents: [{ agent: 'codex', pane_id: 'legacy', cwd: '/other' }], panes: [] },
  }) });
  expect(legacy).toEqual({ kind: 'herdr', source: { agent: 'codex', pane_id: 'legacy', cwd: '/other' } });
});

it('claims current user-turn ownership from its correlated in-progress ACK before the started notification', () => {
  const stream = new LiveOutput(); stream.thread = 'native';
  stream.request({ id: 101, method: 'turn/start', params: { threadId: 'native' } });
  stream.accept({ id: 101, result: { turn: { id: 'acknowledged', status: 'inProgress' } } }, 100);
  expect(stream.turn).toBe('acknowledged'); expect(stream.sample(100).turn).toBe('working'); expect(stream.sample(100).output).toBe(0);
  stream.accept({ method: 'item/agentMessage/delta', params: { threadId: 'native', turnId: 'acknowledged', delta: 'reply' } }, 110);
  const strength = stream.sample(111).output;
  stream.accept({ method: 'turn/started', params: { threadId: 'native', turn: { id: 'acknowledged' } } }, 112);
  expect(stream.sample(111).output).toBe(strength);
});
it('does not claim ownership from failed, uncorrelated, wrong-thread or terminal ACKs', () => {
  const values = [{ id: 101, error: { code: -1 } }, { id: 999, result: { turn: { id: 'u', status: 'inProgress' } } },
    { id: 101, result: { turn: { id: 'u', status: 'failed' } } }, { id: 101, result: { turn: { id: 'u', status: 'completed' } } },
    { id: 101, result: { turn: { id: 'u' } } }, { id: 101, error: { code: -1 }, result: { turn: { id: 'u', status: 'inProgress' } } }];
  for (const message of values) {
    const stream = new LiveOutput(); stream.thread = 'native'; stream.request({ id: 101, method: 'turn/start', params: { threadId: 'native' } });
    stream.accept(message); expect(stream.turn).toBeUndefined(); expect(stream.sample().turn).toBe('idle');
  }
  const stream = new LiveOutput(); stream.thread = 'native'; stream.request({ id: 101, method: 'turn/start', params: { threadId: 'other' } });
  stream.accept({ id: 101, result: { turn: { id: 'u', status: 'inProgress' } } }); expect(stream.turn).toBeUndefined();
});
it('does not revive a completed turn or overwrite a new turn from late ACKs after thread selection', () => {
  const completed = new LiveOutput(); completed.thread = 'native';
  completed.request({ id: 101, method: 'turn/start', params: { threadId: 'native' } });
  completed.accept({ method: 'turn/completed', params: { threadId: 'native', turn: { id: 'old', status: 'completed' } } });
  completed.accept({ id: 101, result: { turn: { id: 'old', status: 'inProgress' } } }); expect(completed.turn).toBeUndefined();
  completed.accept({ method: 'turn/started', params: { threadId: 'native', turn: { id: 'old' } } }); expect(completed.turn).toBeUndefined();
  const changed = new LiveOutput(); changed.thread = 'native';
  changed.request({ id: 101, method: 'turn/start', params: { threadId: 'native' } });
  changed.request({ id: 102, method: 'thread/resume' }); changed.accept({ id: 102, result: { thread: { id: 'new_thread' } } });
  changed.accept({ id: 101, result: { turn: { id: 'old', status: 'inProgress' } } }); expect(changed.thread).toBe('new_thread'); expect(changed.turn).toBeUndefined();
  changed.request({ id: 103, method: 'turn/start', params: { threadId: 'new_thread' } });
  changed.accept({ method: 'turn/started', params: { threadId: 'new_thread', turn: { id: 'newer' } } });
  changed.accept({ id: 103, result: { turn: { id: 'older', status: 'inProgress' } } }); expect(changed.turn).toBe('newer');
});

it('bounds ACK and completion correlation without reopening old completed ACKs after tombstone eviction', () => {
  const stream = new LiveOutput(); stream.thread = 'native';
  stream.request({ id: 501, method: 'turn/start', params: { threadId: 'native' } });
  for (let i = 0; i < 65; i++) stream.accept({ method: 'turn/completed', params: { threadId: 'native', turn: { id: `old_${i}`, status: 'completed' } } });
  expect(stream.completed.size).toBe(64); expect(stream.turnRequests.size).toBe(0);
  stream.accept({ id: 501, result: { turn: { id: 'old_0', status: 'inProgress' } } }); expect(stream.turn).toBeUndefined();
  stream.request({ id: 502, method: 'turn/start', params: { threadId: 'native' } });
  stream.accept({ id: 502, result: { turn: { id: 'fresh', status: 'inProgress' } } }); expect(stream.turn).toBe('fresh');
  for (let i = 0; i < 65; i++) stream.request({ id: 1000 + i, method: 'turn/start', params: { threadId: 'native' } });
  expect(stream.turnRequests.size).toBe(64);
});

it.each(['thread/resume', 'thread/fork'])('refuses %s without forwarding potentially persisted visual instructions', async method => {
  const script = "process.stdin.on('data',()=>{process.stdout.write('UNEXPECTED_THREAD_REQUEST\\n')})";
  const requests = [];
  const transport = await openCodexTransport({ host: { command: process.execPath, args: ['-e', script, '--'] }, args: [],
    cwd: process.cwd(), env: process.env, onRequest: message => requests.push(message) });
  const socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } });
  try {
    await once(socket, 'open'); const response = once(socket, 'message');
    socket.send(JSON.stringify({ id: 1, method, params: { threadId: 'preserved' } }));
    const [bytes] = await response; const value = JSON.parse(bytes.toString());
    expect(value.error.code).toBe(-32602); expect(value.error.message).toContain('Existing threads are preserved');
    expect(requests).toEqual([]);
  } finally { socket.terminate(); await transport.close(); }
});

it.each(['observe', 'invalidate', 'close'])('contains synchronous and rejected presentation %s failures', async method => {
  expect(() => presentationCall({ presentation: { [method]() { throw Error('visual-only failure'); } } }, method)).not.toThrow();
  expect(() => presentationCall({ presentation: { [method]() { return Promise.reject(Error('visual-only rejection')); } } }, method)).not.toThrow();
  await Promise.resolve();
});
