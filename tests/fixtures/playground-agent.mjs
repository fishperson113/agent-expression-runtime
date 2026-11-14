import { once } from 'node:events';
import { WebSocket } from 'ws';

const argv = process.argv.slice(2), emit = value => process.stdout.write(JSON.stringify(value) + '\n');

function rpc(write) {
  let serial = 0; const pending = new Map();
  return { accept: message => {
    const entry = pending.get(message.id); if (!entry || message.method) return false;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(Error('scripted_rpc_error')); else entry.resolve(message.result);
    return true;
  }, close: () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('scripted_rpc_closed')); } pending.clear(); },
  call: (method, params = {}) => new Promise((resolve, reject) => {
    if (pending.size >= 16) { reject(Error('scripted_rpc_limit')); return; }
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('scripted_rpc_timeout')); }, 15000);
    pending.set(id, { resolve, reject, timer }); write({ id, method, params });
  }) };
}

function lines(input, handle) {
  let buffer = '';
  input.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 1048576) { process.exitCode = 1; input.destroy(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); handle(line);
    }
  });
}

async function appServer() {
  if (process.env.FISCH_TEST_MCP_BASE || process.env.FISCH_TEST_MCP_TOKEN) throw Error('test_credentials_in_primary');
  const state = { turn: 0 };
  lines(process.stdin, line => { void request(JSON.parse(line), state).catch(() => emit({ method: 'test/failure', params: { code: 'scripted_native_failure' } })); });
}

async function request(message, state) {
  if (message.method === 'initialize') { emit({ id: message.id, result: { userAgent: 'scripted-native-route' } }); return; }
  if (message.method === 'thread/start') {
    state.thread = 'scripted-native-' + (state.threadIndex = (state.threadIndex ?? 0) + 1);
    emit({ id: message.id, result: { thread: { id: state.thread } } }); return;
  }
  if (message.method === 'thread/resume') { emit({ id: message.id, error: { code: -1, message: 'scripted_missing_thread' } }); return; }
  if (message.method === 'test/complete') {
    emit({ method: 'turn/completed', params: { threadId: state.thread, turn: { id: message.params.turnId, status: 'completed' } } });
    emit({ id: message.id, result: {} }); return;
  }
  if (message.method !== 'turn/start') { if (message.id !== undefined) emit({ id: message.id, result: {} }); return; }
  const turnId = 'scripted-turn-' + ++state.turn;
  emit({ id: message.id, result: { turn: { id: turnId, status: 'inProgress' } } });
  if (!argv.includes('--omit-started')) emit({ method: 'turn/started', params: { threadId: state.thread, turn: { id: turnId } } });

}

async function driverCommand(command, state) {
  const { client } = state;
  if (command.operation === 'exit') { await state.close(); return; }
  let value;
  if (command.operation === 'failedSelect') {
    await client.call('thread/resume', { threadId: 'missing' }).catch(() => {}); value = { selected: false };
  } else if (command.operation === 'selectThread') {
    state.thread = await client.call('thread/start', { cwd: process.cwd() }); value = { selected: true };
  } else if (command.operation === 'complete') {
    value = await client.call('test/complete', { turnId: command.turnId });
  } else {
    const ack = await client.call('turn/start', { threadId: state.thread.thread.id, input: [{ type: 'text', text: command.text ?? JSON.stringify(command) }] });
    value = { turnId: ack.turn.id };
  }
  if (!state.closed) emit({ type: 'result', lane: 'native-fixture', command: command.operation, value });
}

async function nativeClient() {
  const url = argv[argv.indexOf('--remote') + 1], key = argv[argv.indexOf('--remote-auth-token-env') + 1];
  const socket = new WebSocket(url, { headers: { Authorization: 'Bearer ' + process.env[key] } });
  const client = rpc(message => socket.send(JSON.stringify(message)));
  const state = { client, closed: false }; let closing;
  state.close = () => closing ??= (async () => { state.closed = true; client.close(); socket.close(); })();
  socket.on('message', bytes => { const message = JSON.parse(bytes.toString()); client.accept(message);
    if (message.method === 'test/failure' && !state.closed) emit({ type: 'error', code: 'scripted_native_failure' }); });
  socket.on('error', () => {}); socket.on('close', () => { void state.close().finally(() => { process.stdin.pause(); process.stdin.removeAllListeners('data'); }); });
  process.stdin.once('end', () => { void state.close(); });
  try {
    await once(socket, 'open'); await client.call('initialize');
    state.thread = await client.call('thread/start', { cwd: process.cwd() });
    emit({ type: 'ready', scripted: true, lane: 'native-fixture' });
    lines(process.stdin, line => { void driverCommand(JSON.parse(line), state).catch(() => {
      if (!state.closed) emit({ type: 'error', code: 'scripted_external_driver_failure' });
    }); });
  } catch (error) { await state.close(); throw error; }
}

if (argv.includes('app-server')) await appServer(); else await nativeClient();
