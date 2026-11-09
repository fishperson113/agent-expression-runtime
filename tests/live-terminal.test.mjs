import { expect, it } from 'vitest';
import { selectLiveHost } from '../scripts/live-session.mjs';
import { LiveOutput } from '../integrations/live-output.mjs';
import { openCodexTransport, liveInstructions } from '../integrations/live-codex-transport.mjs';
import { WebSocket } from 'ws';
import { once } from 'node:events';

it('uses the current workspace without contacting Herdr when it is absent', async () => {
  const host = await selectLiveHost({ env: {}, cwd: '/tmp/workspace', call: () => { throw Error('must not call Herdr'); } });
  expect(host).toEqual({ kind: 'terminal', cwd: '/tmp/workspace' });
});
it('preserves existing thread instructions and adds Live context exactly once', () => {
  const input = { id: 1, method: 'thread/start', params: { developerInstructions: 'Keep existing policy.' } };
  const result = liveInstructions(input, 'Use your body.');
  expect(result.params.developerInstructions).toContain('Keep existing policy.');
  expect(result.params.developerInstructions).toContain('Use your body.');
  expect(liveInstructions(result, 'Use your body.')).toEqual(result);
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
    expect(JSON.parse(bytes.toString()).result.developerInstructions).toContain('Live instructions');
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
