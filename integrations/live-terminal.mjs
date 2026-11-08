import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { liveCodexArguments } from '../scripts/live-codex.mjs';
import { codexCommand, stopChild } from '../scripts/start-session.mjs';
import { openCodexTransport } from './live-codex-transport.mjs';
import { LiveOutput } from './live-output.mjs';
import { liveRoot } from './live-launch.mjs';

export async function runTerminalCodex({ live, cwd, signal, spawnClient = spawn }) {
  const host = await codexCommand(), output = new LiveOutput();
  const original = liveCodexArguments(liveRoot, cwd), config = original.slice(original.indexOf('-c'));
  const env = { ...process.env, AER_BASE_URL: live.base, AER_PAIRING_TOKEN: live.token, FISCH_LIVE: '1', FISCH_PLANNER_BACKEND: 'off' };
  const instructions = readFileSync(new URL('./live-instructions.md', import.meta.url), 'utf8');
  const transport = await openCodexTransport({ host, args: config, cwd, env, instructions, onEvent: message => output.accept(message) });
  let child;
  const stop = () => { void stopChild(child).catch(() => {}); void transport.close().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    child = spawnClient(host.command, [...host.args, '--remote', transport.url, '--remote-auth-token-env', 'FISCH_CODEX_TRANSPORT_TOKEN', '--no-alt-screen', '-C', cwd],
      { cwd, env: { ...env, FISCH_CODEX_TRANSPORT_TOKEN: transport.token }, windowsHide: true, stdio: 'inherit' });
    const finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
    const timer = setInterval(() => {
      if (!live.page.isClosed()) void live.page.evaluate(value => window.fischLive.activity(value), output.sample()).catch(stop);
    }, 100);
    try { if (signal.aborted) stop(); return await finished; }
    finally { clearInterval(timer); }
  } finally {
    signal.removeEventListener('abort', stop);
    await Promise.allSettled([stopChild(child), transport.close()]);
  }
}
