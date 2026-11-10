import { WebSocket } from 'ws';
import { once } from 'node:events';
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
function lines(stream, handle) {
  let buffer = '';
  stream.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1048576) { process.exitCode = 1; stream.destroy(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); handle(value);
    }
  });
}
function server() {
  let thread = 0, turn = 0, last; const seen = [];
  lines(process.stdin, message => {
    const { method, params = {} } = message;
    seen.push({ method, thread: params.threadId, turn: params.turnId, text: params.input?.[0]?.text }); if (seen.length > 32) seen.shift();
    const reply = result => emit({ id: message.id, result });
    if (method === 'thread/start') { reply({ thread: { id: 'thread-' + ++thread } }); return; }
    if (method === 'thread/resume') {
      if (params.threadId === 'missing') emit({ id: message.id, error: { code: -1, message: 'synthetic_missing_thread' } });
      else reply({ thread: { id: params.threadId } }); return;
    }
    if (method === 'turn/start') {
      last = { id: message.id, thread: params.threadId, turn: 'turn-' + ++turn };
      if (process.argv.includes('--silent')) { emit({ method: 'test/sent', params: { turn: last.turn } }); return; }
      reply({ turn: { id: last.turn, status: 'inProgress' } });
      emit({ method: 'item/started', params: { threadId: last.thread, turnId: last.turn, item: { id: 'user-' + turn, type: 'userMessage', content: params.input } } });
      emit({ method: 'item/agentMessage/delta', params: { threadId: last.thread, turnId: last.turn, itemId: 'reply-' + turn, delta: 'Public synthetic reply.' } }); return;
    }
    if (method === 'turn/interrupt') emit({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: params.turnId, status: 'interrupted' } } });
    if (method === 'test/late') { emit({ id: last.id, result: { turn: { id: last.turn, status: 'inProgress' } } }); emit({ method: 'turn/started', params: { threadId: last.thread, turn: { id: last.turn } } }); }
    if (method === 'test/approval') emit({ id: 900, method: 'item/commandExecution/requestApproval', params: { threadId: last.thread, turnId: last.turn } });
    reply(method === 'test/snapshot' ? { seen, keys: Object.keys(process.env).filter(key => key.startsWith('FISCH_REACTIVE_')) } : {});
  });
}
async function client() {
  const argv = process.argv, socket = new WebSocket(argv[argv.indexOf('--remote') + 1], {
    headers: { Authorization: 'Bearer ' + process.env[argv[argv.indexOf('--remote-auth-token-env') + 1]] } });
  let serial = 0; const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    if (pending.size >= 16) { reject(Error('synthetic_limit')); return; }
    const id = ++serial; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params }));
  });
  socket.on('message', bytes => { const value = JSON.parse(bytes.toString());
    if (pending.has(value.id) && !value.method) { pending.get(value.id)(value); pending.delete(value.id); } else emit({ type: 'event', value }); });
  socket.on('error', () => {}); socket.on('close', () => process.exit(0));
  await once(socket, 'open'); await call('initialize'); await call('thread/start'); emit({ type: 'ready' });
  lines(process.stdin, command => { void call(command.method, command.params).then(value => emit({ type: 'reply', tag: command.tag, value })); });
  process.stdin.on('end', () => socket.close());
}
if (process.argv.includes('app-server')) server(); else await client();
