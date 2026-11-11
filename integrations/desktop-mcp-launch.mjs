import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readDesktopRuntime } from './desktop-runtime.mjs';
import { stopChild } from '../scripts/start-session.mjs';

export async function runDesktopMcp({ signal, input = process.stdin, output = process.stdout, error = process.stderr,
  env = process.env, runtimeOptions, read = readDesktopRuntime, spawnChild = spawn, stop = stopChild } = {}) {
  if (signal?.aborted) return 130;
  const connection = read({ ...runtimeOptions, env });
  const child = spawnChild(process.execPath, [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))], {
    env: { ...env, AER_BASE_URL: connection.base, AER_PAIRING_TOKEN: connection.token, FISCH_LIVE: '1', FISCH_MCP_REQUIRE_THREAD: '1' },
    stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true
  });
  const closed = new Promise((resolve, reject) => { child.once('error', () => reject(Error('desktop_mcp_start_failed'))); child.once('close', code => resolve(code ?? 1)); });
  let closing;
  const shutdown = () => closing ??= Promise.resolve().then(async () => { input.unpipe(child.stdin); child.stdin.end(); await stop(child); });
  const onAbort = () => { void shutdown().catch(() => {}); };
  child.stdin.on('error', () => {}); input.once('end', onAbort); output.on('error', onAbort); error.on('error', onAbort);
  signal?.addEventListener('abort', onAbort, { once: true });
  input.pipe(child.stdin); child.stdout.pipe(output, { end: false }); child.stderr.pipe(error, { end: false });
  try { if (signal?.aborted) onAbort(); const code = await closed; return signal?.aborted ? 130 : code; }
  finally {
    signal?.removeEventListener('abort', onAbort); input.removeListener('end', onAbort); output.removeListener('error', onAbort); error.removeListener('error', onAbort);
    input.unpipe(child.stdin); input.pause(); child.stdout.unpipe(output); child.stderr.unpipe(error); await shutdown();
  }
}
