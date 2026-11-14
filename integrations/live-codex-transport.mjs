import { fischCodexServiceTier } from './fisch-codex-runtime.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { stopChild } from '../scripts/start-session.mjs';
import { closeLiveOwned } from './live-shutdown.mjs';

export function liveInstructions(message, instructions) {
  if (!['thread/start', 'thread/resume', 'thread/fork'].includes(message.method)) return message;
  const params = { ...message.params }, existing = params.developerInstructions ?? '';
  params.developerInstructions = existing.includes('FISCH_LIVE_BODY') ? existing : existing + '\nFISCH_LIVE_BODY\n' + instructions;
  return { ...message, params };
}

const nativeConfigKeys = new Set(['model', 'model_provider', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity', 'service_tier']);
function nativeConversationConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  const entries = Object.entries(config).filter(([key, value]) => nativeConfigKeys.has(key) && (typeof value === 'string' || value === null));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function scopedLiveRequest(message, cwd, instructions, serviceTier = fischCodexServiceTier()) {
  if (!['thread/start', 'thread/resume', 'thread/fork', 'turn/start'].includes(message.method)) return message;
  const params = { ...message.params, cwd };
  if (message.method !== 'turn/start' && params.serviceTier == null) params.serviceTier = serviceTier;
  const config = nativeConversationConfig(params.config);
  if (config) params.config = config; else delete params.config;
  delete params.path; delete params.environment;
  if (message.method !== 'turn/start') {
    delete params.skillRoots; delete params.dynamicTools;
    return liveInstructions({ ...message, params }, instructions);
  }
  return { ...message, params };
}

function relayOutput(child, connection, onEvent, close) {
  let buffer = '', draining = false;
  child.stderr.resume();
  child.stdin.on('error', () => { void close(); });
  child.stdout.on('data', chunk => {
    child.stdout.pause();
    buffer += chunk;
    if (buffer.length > 1048576) { void close(); return; }
    void drain();
  });
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (connection.bufferedAmount > 1048576) throw Error('relay_backpressure');
        const message = JSON.parse(line); const outgoing = await onEvent(message);
        if (outgoing === false) continue;
        if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify(outgoing ?? message));
      }
    } catch { void close(); }
    finally { draining = false; child.stdout.resume(); }
  }
}

export async function openCodexTransport({ host, args, cwd, env, instructions, onEvent = () => {}, onRequest = () => {}, onFailure = () => {} }) {
  const token = randomBytes(32).toString('hex'), expected = Buffer.from('Bearer ' + token);
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1048576 });
  let child, client, closed = false, closing;
  const rpc = new LiveRequests(message => {
    if (closed || !child?.stdin.writable || child.stdin.writableLength > 1048576) throw Error('relay_unavailable');
    child.stdin.write(JSON.stringify(scopedLiveRequest(message, cwd, instructions, fischCodexServiceTier(env))) + '\n');
  });
  server.on('upgrade', (request, socket, head) => {
    const given = Buffer.from(request.headers.authorization ?? '');
    if (request.headers.origin || given.length !== expected.length || !timingSafeEqual(given, expected) || client) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, connection => { client = connection; attach(connection); });
  });
  const close = () => closing ??= closeLiveOwned([() => {
    closed = true; rpc.close(); client?.terminate();
  }, () => new Promise((resolve, reject) => sockets.close(error => error ? reject(error) : resolve())),
  () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), () => stopChild(child)]);
  const fail = () => { if (closed) return; try { onFailure(); } finally { void close().catch(() => {}); } };
  function attach(connection) {
    child = spawn(host.command, [...host.args, 'app-server', '--stdio', ...args], { cwd, env, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    child.aerProcessGroup = process.platform !== 'win32';
    relayOutput(child, connection, async message => {
      await rpc.observe(message);
      const outgoing = rpc.accept(message);
      if (outgoing === false) return false;
      await onEvent(outgoing); return outgoing;
    }, fail);
    connection.on('message', bytes => {
      try {
        if (child.stdin.writableLength > 1048576) throw Error('relay_backpressure');
        const message = liveInstructions(JSON.parse(bytes.toString()), instructions);
        if (rejectReservedClient(connection, message, rpc.prefix)) return;
        if (onRequest(message) !== false) rpc.client(message);
      }
      catch { fail(); }
    });
    connection.once('close', () => { void close().catch(() => {}); });
    child.once('error', fail); child.once('exit', fail);
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return transportControls(rpc, () => client, 'ws://127.0.0.1:' + server.address().port, token, close, onEvent, onRequest);
}

function rejectReservedClient(connection, message, prefix) {
  if (!message.method || typeof message.id !== 'string' || !message.id.startsWith(prefix)) return false;
  connection.send(JSON.stringify({ id: message.id, error: { code: -32600, message: 'relay_request_id_reserved' } }));
  return true;
}
function guardAllows(guard, message) {
  try { return guard(message) === true; } catch { return false; }
}
function transportControls(rpc, getClient, url, token, close, onEvent, onRequest) {
  const submit = (method, params, guard, discard) => {
    if (typeof guard !== 'function') return Promise.reject(Object.assign(Error('relay_guard_required'), { uncertain: false }));
    return rpc.request(method, params, { guard, discard, observe: onEvent, dispatch: message => {
      if (!guardAllows(guard, message)) { rpc.fail(message.id, 'relay_guard_rejected'); return; }
      if (onRequest(message) !== false) rpc.forward(message);
    } });
  };
  return { url, token, close, reject: (message, error) => {
    if (rpc.rejectOwned(message)) return;
    const client = getClient();
    if (client?.readyState === WebSocket.OPEN && message.id !== undefined) client.send(JSON.stringify({ id: message.id, error }));
  }, request: (method, params) => rpc.request(method, params), forward: message => rpc.forward(message),
  submitUser: (params, guard, discard) => submit('turn/start', params, guard, discard),
  interruptUser: (params, guard, discard) => submit('turn/interrupt', params, guard, discard) };
}

export class LiveRequests {
  pending = new Map(); escaped = new Map(); owned = new WeakMap(); serial = 0;
  prefix = 'fisch:' + randomBytes(16).toString('hex') + ':';
  constructor(write) { this.write = write; }
  request(method, params, options = {}) {
    if (this.pending.size >= 8) return Promise.reject(Object.assign(Error('relay_request_limit'), { uncertain: false }));
    const id = this.prefix + ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, 'relay_request_timeout'), 10000), owned = typeof options.guard === 'function';
      this.pending.set(id, { resolve, reject, timer, owned, sent: false, expiresAt: performance.now() + 10000, observe: options.observe, discard: options.discard });
      try {
        const message = { id, method, params: owned ? structuredClone(params) : params };
        if (owned) this.owned.set(message, options.guard);
        if (options.dispatch) options.dispatch(message); else if (owned) this.forward(message); else this.write(message);
      } catch (error) { this.fail(id, owned ? 'relay_dispatch_rejected' : error); }
    });
  }
  async observe(message) {
    if (message.method) return;
    const pending = this.pending.get(message.id);
    if (pending?.owned && performance.now() >= pending.expiresAt) { this.fail(message.id, 'relay_request_timeout'); return; }
    if (pending?.owned && !pending.sent) return;
    if (!pending?.observe || pending.observed) return;
    pending.observed = true;
    try { await pending.observe(message); }
    catch { this.fail(message.id, 'relay_observation_unknown'); throw Error('relay_observation_unknown'); }
  }
  forward(message) {
    const guard = this.owned.get(message);
    if (!guard) return this.client(message);
    const pending = this.pending.get(message.id);
    if (!pending) throw Error('relay_owned_expired');
    if (performance.now() >= pending.expiresAt) {
      this.fail(message.id, 'relay_request_timeout'); throw Error('relay_owned_expired');
    }
    if (pending.sent || !guardAllows(guard, message)) {
      this.fail(message.id, pending.sent ? 'relay_duplicate_forward' : 'relay_guard_rejected'); throw Error('relay_guard_rejected');
    }
    pending.sent = true;
    try { this.write(message); }
    catch { this.fail(message.id, 'relay_write_unknown'); throw Error('relay_write_unknown'); }
  }
  fail(id, reason) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(id);
    const error = typeof reason === 'string' ? Error(reason) : reason;
    if (pending.owned) error.uncertain = pending.sent;
    try { pending.discard?.(id); } catch { /* Cleanup cannot prevent settlement. */ }
    pending.reject(error);
  }
  rejectOwned(message) {
    if (!this.owned.has(message)) return false;
    this.fail(message.id, 'relay_owned_rejected'); return true;
  }
  client(message) {
    if (message.method && typeof message.id === 'string' && message.id.startsWith(this.prefix)) {
      if (this.escaped.size >= 64) throw Error('relay_request_limit');
      const id = this.prefix + 'client:' + ++this.serial;
      this.escaped.set(id, message.id); message = { ...message, id };
    }
    this.write(message);
  }
  accept(message) {
    if (message.method || message.id === undefined) return message;
    const pending = this.pending.get(message.id);
    if (pending) {
      if (pending.owned && !pending.sent) return false;
      clearTimeout(pending.timer); this.pending.delete(message.id); pending.resolve(message); return false;
    }
    if (this.escaped.has(message.id)) {
      const id = this.escaped.get(message.id); this.escaped.delete(message.id); return { ...message, id };
    }
    if (typeof message.id === 'string' && message.id.startsWith(this.prefix)) return false;
    return message;
  }
  close() {
    for (const id of this.pending.keys()) this.fail(id, 'relay_closed');
    this.pending.clear(); this.escaped.clear();
  }
}
