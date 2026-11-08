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
  const script = `let b='';process.stdin.on('data',c=>{b+=c;let n;while((n=b.indexOf('\\n'))>=0){let m=JSON.parse(b.slice(0,n));b=b.slice(n+1);process.stdout.write(JSON.stringify({id:m.id,result:m.params})+'\\n')}})`;
  const transport = await openCodexTransport({ host: { command: process.execPath, args: ['-e', script, '--'] }, args: [],
    cwd: process.cwd(), env: process.env, instructions: 'Live instructions' });
  let socket;
  try {
    const rejected = new WebSocket(transport.url);
    await expect(once(rejected, 'open')).rejects.toThrow('403');
    socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } });
    await once(socket, 'open');
    const response = once(socket, 'message');
    socket.send(JSON.stringify({ id: 1, method: 'thread/start', params: { cwd: '/tmp/workspace' } }));
    const [bytes] = await response;
    expect(JSON.parse(bytes.toString()).result.developerInstructions).toContain('Live instructions');
    expect(transport.url).not.toContain(transport.token);
  } finally { socket?.terminate(); await transport.close(); }
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
