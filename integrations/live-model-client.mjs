import { readFileSync } from 'node:fs';
import { EventEmitter, once } from 'node:events';
import { WebSocket } from 'ws';
import { codexCommand } from '../scripts/start-session.mjs';
import { liveCodexArguments } from '../scripts/live-codex.mjs';
import { openCodexTransport } from './live-codex-transport.mjs';
import { LiveOutput } from './live-output.mjs';
import { liveRoot } from './live-launch.mjs';

function protocol(socket) {
  let id = 0; const pending = new Map(), events = new EventEmitter();
  socket.on('error', () => {});
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.method && message.id !== undefined) {
      socket.send(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Interactive approval unavailable in model test; no approval granted.' } }));
      return;
    }
    const entry = pending.get(message.id);
    if (entry) { clearTimeout(entry.timer); pending.delete(message.id); message.error ? entry.reject(Error('app_server_request_failed')) : entry.resolve(message.result); }
    else events.emit('notification', message);
  });
  socket.on('close', () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('app_server_closed')); }
    pending.clear(); events.emit('closed'); });
  const call = (method, params) => new Promise((resolve, reject) => {
    if (pending.size >= 8) return reject(Error('model_test_rpc_full'));
    const next = ++id, timer = setTimeout(() => { pending.delete(next); reject(Error('app_server_timeout')); }, 30000);
    pending.set(next, { resolve, reject, timer }); socket.send(JSON.stringify({ id: next, method, params }));
  });
  return { call, events };
}
export async function openModelClient(live, { onRequest = () => {} } = {}) {
  const output = new LiveOutput(() => live.page.evaluate(() => window.fischLive.selectThread())), host = await codexCommand(), original = liveCodexArguments(liveRoot);
  const transport = await openCodexTransport({ host, args: [...original.slice(original.indexOf('-c')), '-c', 'projects={"' + liveRoot.replace(/\/$/, '') + '"={trust_level="untrusted"}}', '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="on-request"'], cwd: liveRoot,
    env: { ...process.env, AER_BASE_URL: live.base, AER_PAIRING_TOKEN: live.token, FISCH_LIVE: '1', FISCH_PLANNER_BACKEND: 'off' },
    instructions: readFileSync(new URL('./live-instructions.md', import.meta.url), 'utf8'), onEvent: message => output.accept(message), onRequest: message => { output.request(message); onRequest(message); } });
  const socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } });
  const timer = setInterval(() => { if (!live.page.isClosed()) void live.page.evaluate(value => window.fischLive.activity(value), output.sample()).catch(() => {}); }, 100);
  try {
    await once(socket, 'open'); const rpc = protocol(socket);
    await rpc.call('initialize', { clientInfo: { name: 'fisch_holdout', version: '0.1.0' }, capabilities: null });
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));
    return { ...rpc, focus: threadId => { output.thread = threadId; output.turn = undefined; output.state = 'idle'; },
      close: async () => { clearInterval(timer); socket.terminate(); await transport.close(); } };
  } catch (error) { clearInterval(timer); socket.terminate(); await transport.close(); throw error; }
}
export async function runModelTurn(client, threadId, text, timeoutMs = 90000, onTool = () => {}) {
  const tools = []; let settled, turnId, truncated = false;
  const done = new Promise((resolve, reject) => { settled = { resolve, reject }; });
  void done.catch(() => {});
  const receive = message => {
    const p = message.params;
    if (p?.threadId !== threadId) return;
    if (message.method === 'turn/started') turnId = p.turn.id;
    if (message.method === 'item/completed' && p.turnId === turnId && p.item?.type === 'mcpToolCall') {
      if (tools.length < 64) { tools.push(p.item); onTool(p.item); } else truncated = true;
    }
    if (message.method === 'turn/completed' && p.turn.id === turnId) settled.resolve({ status: p.turn.status, tools, truncated });
  };
  client.events.on('notification', receive);
  const disconnected = () => settled.reject(Error('app_server_closed'));
  client.events.once('closed', disconnected);
  const timer = setTimeout(() => { if (turnId) void client.call('turn/interrupt', { threadId, turnId }).catch(() => {}); settled.reject(Error('model_turn_timeout')); }, timeoutMs);
  try {
    await client.call('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] });
    return await done;
  } finally { clearTimeout(timer); client.events.removeListener('notification', receive); client.events.removeListener('closed', disconnected); }
}
