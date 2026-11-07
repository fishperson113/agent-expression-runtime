import net from 'node:net';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, lstatSync, unlinkSync } from 'node:fs';

export function controlAddress(paneId, namespace = process.env.HERDR_SOCKET_PATH, platform = process.platform) {
  if (!paneId || !namespace) throw Object.assign(Error('Use Fisch from a Herdr pane.'), { public: true });
  const hash = createHash('sha256').update(`${homedir()}\0${namespace}\0${paneId}`).digest('hex').slice(0, 24);
  if (platform === 'win32') return `\\\\.\\pipe\\fisch-${hash}`;
  const directory = join(tmpdir(), `fisch-${process.getuid?.() ?? 'user'}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077))
    throw Error('Fisch IPC directory is not private to this user.');
  return join(directory, hash + '.sock');
}
export function sendControl(method, args, paneId = process.env.HERDR_PANE_ID, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const socket = net.connect(controlAddress(paneId), () => socket.write(JSON.stringify({ method, args }) + '\n'));
    const fail = () => { socket.destroy(); reject(Object.assign(Error('No Fisch body attached to this agent pane. Run fisch run in its neighboring pane.'), { public: true })); };
    socket.setTimeout(timeoutMs, fail); socket.on('error', fail);
    socket.on('end', () => { if (!buffer.includes('\n')) fail(); });
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 131072) return fail();
      if (!buffer.includes('\n')) return;
      try { const response = JSON.parse(buffer.split('\n')[0]); socket.destroy(); resolve(response); }
      catch { fail(); }
    });
  });
}
export async function openControl(paneId, handler, namespace = process.env.HERDR_SOCKET_PATH) {
  const address = controlAddress(paneId, namespace);
  const server = net.createServer(socket => {
    let buffer = ''; socket.setTimeout(3000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 32768) return socket.destroy();
      if (!buffer.includes('\n')) return;
      socket.removeAllListeners('data');
      Promise.resolve().then(() => handler(JSON.parse(buffer.split('\n')[0]))).catch(error => ({
        status: 'rejected', code: error.code ?? error.message, ...(error.path ? { path: error.path } : {}),
      })).then(result => socket.end(JSON.stringify(result) + '\n'));
    });
  });
  server.maxConnections = 4;
  const listen = () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ path: address, readableAll: false, writableAll: false, exclusive: true }, resolve);
  });
  try { await listen(); }
  catch (error) {
    if (process.platform === 'win32' || error.code !== 'EADDRINUSE') throw error;
    const stale = await new Promise(resolve => {
      const probe = net.connect(address, () => { probe.destroy(); resolve(false); });
      probe.setTimeout(500, () => { probe.destroy(); resolve(false); });
      probe.on('error', error => resolve(error.code === 'ECONNREFUSED'));
    });
    const info = lstatSync(address);
    if (!stale || !info.isSocket() || info.uid !== process.getuid()) throw error;
    unlinkSync(address); await listen();
  }
  return { address, close: () => new Promise(resolve => server.close(resolve)) };
}
