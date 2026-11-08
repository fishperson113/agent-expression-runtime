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

export async function openCodexTransport({ host, args, cwd, env, instructions, onEvent = () => {}, onRequest = () => {} }) {
  const token = randomBytes(32).toString('hex'), expected = Buffer.from('Bearer ' + token);
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1048576 });
  let child, client, closed = false;
  server.on('upgrade', (request, socket, head) => {
    const given = Buffer.from(request.headers.authorization ?? '');
    if (request.headers.origin || given.length !== expected.length || !timingSafeEqual(given, expected) || client) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, connection => { client = connection; attach(connection); });
  });
  const close = async () => {
    if (closed) return; closed = true;
    client?.terminate(); sockets.close(); server.close(); await stopChild(child);
  };
  function attach(connection) {
    child = spawn(host.command, [...host.args, 'app-server', '--stdio', ...args], { cwd, env, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    child.aerProcessGroup = process.platform !== 'win32';
    let buffer = '';
    child.stderr.resume();
    child.stdin.on('error', () => { void close(); });
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1048576) { void close(); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          if (connection.bufferedAmount > 1048576) throw Error('relay_backpressure');
          const message = JSON.parse(line); onEvent(message);
          if (connection.readyState === WebSocket.OPEN) connection.send(line);
        }
        catch { void close(); return; }
      }
    });
    connection.on('message', bytes => {
      try {
        if (child.stdin.writableLength > 1048576) throw Error('relay_backpressure');
        const message = liveInstructions(JSON.parse(bytes.toString()), instructions);
        onRequest(message); child.stdin.write(JSON.stringify(message) + '\n');
      }
      catch { void close(); }
    });
    connection.once('close', () => { void close(); });
    child.once('error', () => { void close(); }); child.once('exit', () => { void close(); });
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: 'ws://127.0.0.1:' + server.address().port, token, close };
}
