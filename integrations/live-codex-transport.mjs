import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { stopChild } from '../scripts/start-session.mjs';

export function liveInstructions(message, instructions) {
  if (!['thread/start', 'thread/resume'].includes(message.method)) return message;
  const params = { ...message.params }, existing = params.developerInstructions ?? '';
  params.developerInstructions = existing.includes('FISCH_LIVE_BODY') ? existing : existing + '\nFISCH_LIVE_BODY\n' + instructions;
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

export async function openCodexTransport({ host, args, cwd, env, instructions, onEvent = () => {}, onRequest = () => {} }) {
  const token = randomBytes(32).toString('hex'), expected = Buffer.from('Bearer ' + token);
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1048576 });
  let child, client, closed = false;
  const rpc = new LiveRequests(message => {
    if (closed || !child?.stdin.writable || child.stdin.writableLength > 1048576) throw Error('relay_unavailable');
    child.stdin.write(JSON.stringify(message) + '\n');
  });
  server.on('upgrade', (request, socket, head) => {
    const given = Buffer.from(request.headers.authorization ?? '');
    if (request.headers.origin || given.length !== expected.length || !timingSafeEqual(given, expected) || client) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, connection => { client = connection; attach(connection); });
  });
  const close = async () => {
    if (closed) return; closed = true; rpc.close();
    client?.terminate(); sockets.close(); server.close(); await stopChild(child);
  };
  function attach(connection) {
    child = spawn(host.command, [...host.args, 'app-server', '--stdio', ...args], { cwd, env, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    child.aerProcessGroup = process.platform !== 'win32';
    relayOutput(child, connection, async message => {
      const outgoing = rpc.accept(message);
      if (outgoing === false) return false;
      await onEvent(outgoing); return outgoing;
    }, close);
    connection.on('message', bytes => {
      try {
        if (child.stdin.writableLength > 1048576) throw Error('relay_backpressure');
        const message = liveInstructions(JSON.parse(bytes.toString()), instructions);
        if (onRequest(message) !== false) rpc.client(message);
      }
      catch { void close(); }
    });
    connection.once('close', () => { void close(); });
    child.once('error', () => { void close(); }); child.once('exit', () => { void close(); });
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: 'ws://127.0.0.1:' + server.address().port, token, close, reject: (message, error) => {
    if (client?.readyState === WebSocket.OPEN && message.id !== undefined) client.send(JSON.stringify({ id: message.id, error }));
  }, request: (method, params) => rpc.request(method, params), forward: message => rpc.client(message) };
}

export class LiveRequests {
  pending = new Map(); escaped = new Map(); serial = 0;
  prefix = 'fisch:' + randomBytes(16).toString('hex') + ':';
  constructor(write) { this.write = write; }
  request(method, params) {
    if (this.pending.size >= 8) return Promise.reject(Error('relay_request_limit'));
    const id = this.prefix + ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('relay_request_timeout')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
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
      clearTimeout(pending.timer); this.pending.delete(message.id); pending.resolve(message); return false;
    }
    if (this.escaped.has(message.id)) {
      const id = this.escaped.get(message.id); this.escaped.delete(message.id); return { ...message, id };
    }
    if (typeof message.id === 'string' && message.id.startsWith(this.prefix)) return false;
    return message;
  }
  close() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('relay_closed')); }
    this.pending.clear(); this.escaped.clear();
  }
}
