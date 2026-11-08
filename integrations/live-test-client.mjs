import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopChild } from '../scripts/start-session.mjs';

export function liveTestClient(base, token) {
  const script = fileURLToPath(new URL('./mcp-server.mjs', import.meta.url));
  const child = spawn(process.execPath, [script], { env: { ...process.env, AER_BASE_URL: base, AER_PAIRING_TOKEN: token, FISCH_LIVE: '1' },
    stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let buffer = '', id = 0; const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1000000) { child.kill(); return; }
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const entry = pending.get(message.id); if (!entry) continue;
      clearTimeout(entry.timer); pending.delete(message.id);
      if (message.error) entry.reject(Error(message.error.message)); else entry.resolve(message.result);
    }
  });
  child.stdin.on('error', () => {});
  child.once('exit', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('MCP exited')); } pending.clear(); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id, timer = setTimeout(() => { pending.delete(next); reject(Error('MCP deadline')); }, 6000);
    pending.set(next, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
  });
  return { call, tool: (name, arguments_ = {}) => call('tools/call', { name, arguments: arguments_ }),
    close: async () => { child.stdin.end(); await stopChild(child); } };
}
export function toolValue(result) {
  if (result.isError) throw Error(result.content?.[0]?.text ?? 'MCP tool failed');
  return JSON.parse(result.content[0].text);
}
