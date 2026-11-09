import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const argv = process.argv.slice(2), emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const valueOf = (key, fallback) => {
  const argument = argv.find(value => value.startsWith(key + '='));
  return argument ? JSON.parse(argument.slice(key.length + 1)) : fallback;
};

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
  const command = valueOf('mcp_servers.fisch_live.command'), args = valueOf('mcp_servers.fisch_live.args');
  if (typeof command !== 'string' || !Array.isArray(args) || args.some(value => typeof value !== 'string')) throw Error('scripted_missing_mcp_configuration');
  const mcp = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  mcp.stderr.resume();
  const client = rpc(message => mcp.stdin.write(JSON.stringify(message) + '\n'));
  lines(mcp.stdout, line => client.accept(JSON.parse(line)));
  const ready = (async () => { await client.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'scripted-native-route', version: '1' } });
    const result = await client.call('tools/list'); return result.tools.map(tool => tool.name); })();
  const state = { turn: 0, client, ready };
  lines(process.stdin, line => { void request(JSON.parse(line), state).catch(() => emit({ method: 'test/failure', params: { code: 'scripted_native_failure' } })); });
  process.stdin.once('end', () => { client.close(); mcp.stdin.end(); });
  process.once('exit', () => mcp.kill());
}

async function tool(state, turnId, name, args) {
  const threadId = state.thread;
  const item = { id: 'scripted-call-' + turnId + '-' + name, type: 'mcpToolCall', server: 'fisch_live', tool: name, arguments: args, status: 'inProgress' };
  emit({ method: 'item/started', params: { threadId, turnId, item } });
  const result = await state.client.call('tools/call', { name, arguments: args });
  const { isError, ...content } = result;
  state.lastTool = { method: 'item/completed', params: { threadId, turnId, item: { ...item,
    status: isError ? 'failed' : 'completed', result: content, ...(isError ? { error: { message: 'scripted_tool_failed' } } : {}) } } };
  emit(state.lastTool);
  return JSON.parse(result.content[0].text);
}

async function action(command, state, turnId) {
  if (command.operation === 'state') return tool(state, turnId, 'playground_state', { includeScene: command.includeScene ?? false });
  if (command.operation === 'express') return tool(state, turnId, 'express', { body: { type: 'morph', target: 'wall', durationMs: 100 } });
  if (command.operation === 'interrupt') return tool(state, turnId, 'cancel_expression', {});
  const snapshot = await tool(state, turnId, 'playground_state', {});
  return tool(state, turnId, 'playground_edit', { operation: command.operation, expectedRevision: snapshot.revision,
    ...(['create', 'remix'].includes(command.operation) ? { scene: command.scene } : {}) });
}

async function request(message, state) {
  if (message.method === 'initialize') { emit({ id: message.id, result: { userAgent: 'scripted-native-route' } }); return; }
  if (message.method === 'thread/start') {
    state.thread = 'scripted-native-' + (state.threadIndex = (state.threadIndex ?? 0) + 1);
    emit({ id: message.id, result: { thread: { id: state.thread }, tools: await state.ready } }); return;
  }
  if (message.method === 'thread/resume') { emit({ id: message.id, error: { code: -1, message: 'scripted_missing_thread' } }); return; }
  if (message.method === 'test/old-tool') { if (state.lastTool) emit(state.lastTool); emit({ id: message.id, result: {} }); return; }
  if (message.method !== 'turn/start') { if (message.id !== undefined) emit({ id: message.id, result: {} }); return; }
  const turnId = 'scripted-turn-' + ++state.turn;
  const command = JSON.parse(message.params.input[0].text);
  emit({ id: message.id, result: { turn: { id: turnId, status: 'inProgress' } } });
  if (!argv.includes('--omit-started')) emit({ method: 'turn/started', params: { threadId: state.thread, turn: { id: turnId } } });
  const value = await action(command, state, turnId);
  emit({ method: 'test/playground/result', params: { operation: command.operation, value } });
  emit({ method: 'turn/completed', params: { threadId: state.thread, turn: { id: turnId, status: 'completed' } } });
}

async function nativeClient() {
  const url = argv[argv.indexOf('--remote') + 1], key = argv[argv.indexOf('--remote-auth-token-env') + 1];
  const socket = new WebSocket(url, { headers: { Authorization: 'Bearer ' + process.env[key] } });
  const client = rpc(message => socket.send(JSON.stringify(message)));
  socket.on('message', bytes => { const message = JSON.parse(bytes.toString());
    if (!client.accept(message) && message.method === 'test/playground/result') emit({ type: 'result', command: message.params.operation, value: message.params.value });
    if (message.method === 'test/failure') emit({ type: 'error', code: 'scripted_native_failure' });
  });
  socket.on('error', () => {}); socket.on('close', () => { client.close(); process.exit(0); });
  await once(socket, 'open'); await client.call('initialize');
  let thread = await client.call('thread/start', { cwd: process.cwd() });
  emit({ type: 'ready', scripted: true, tools: thread.tools });
  lines(process.stdin, line => { void (async () => {
    const command = JSON.parse(line);
    if (command.operation === 'exit') { socket.close(); return; }
    if (command.operation === 'failedSelect') {
      await client.call('thread/resume', { threadId: 'missing' }).catch(() => {});
      emit({ type: 'result', command: command.operation, value: { selected: false } }); return;
    }
    if (command.operation === 'selectThread') {
      thread = await client.call('thread/start', { cwd: process.cwd() }); await client.call('test/old-tool');
      emit({ type: 'result', command: command.operation, value: { selected: true } }); return;
    }
    void client.call('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: JSON.stringify(command) }] }).catch(() => emit({ type: 'error', code: 'scripted_turn_failed' }));
  })().catch(() => emit({ type: 'error', code: 'scripted_native_failure' })); });
}

if (argv.includes('app-server')) await appServer(); else await nativeClient();
