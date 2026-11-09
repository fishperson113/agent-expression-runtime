import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { liveCodexArguments } from '../scripts/live-codex.mjs';
import { codexCommand, stopChild } from '../scripts/start-session.mjs';
import { openCodexTransport } from './live-codex-transport.mjs';
import { LiveReactiveBroker } from './live-reactive-broker.mjs';
import { createLiveReactiveProvider, nativeLiveEnvironment } from './live-reactive-provider.mjs';
import { LiveOutput } from './live-output.mjs';
import { PlaygroundProjection } from './playground-projection.mjs';
import { liveSetupStatus } from './live-setup-status.mjs';
import { liveRoot } from './live-launch.mjs';

export async function runTerminalCodex({ live, cwd, signal, spawnClient = spawn, host: suppliedHost, reactiveProvider }) {
  let broker;
  const projection = new PlaygroundProjection();
  const host = suppliedHost ?? await codexCommand(), output = new LiveOutput(async (thread, previous) => {
    projection.select(thread);
    await broker.evaluate(() => window.fischLive.selectThread());
    if (previous) await broker.evaluate(() => window.fischLive.playgroundClear?.()).catch(() => {});
    await publishSetup('connected');
  });
  const original = liveCodexArguments(liveRoot, cwd), config = original.slice(original.indexOf('-c'));
  const env = { ...nativeLiveEnvironment(process.env), AER_BASE_URL: live.base, AER_PAIRING_TOKEN: live.token, FISCH_LIVE: '1', FISCH_PLANNER_BACKEND: 'off' };
  const instructions = readFileSync(new URL('./live-instructions.md', import.meta.url), 'utf8');
  const configured = reactiveProvider === undefined ? createLiveReactiveProvider(process.env) : { provider: reactiveProvider, reason: reactiveProvider ? 'ready' : 'disabled_by_config' };
  const publishSetup = native => broker.evaluate(value => window.fischLive.setupStatus?.(value), liveSetupStatus(native, configured)).catch(() => {});
  const logs = [];
  const transport = await openCodexTransport({ host, args: config, cwd, env, instructions,
    onEvent: async message => {
      await output.accept(message); broker?.event(message);
      const started = output.turn ? projection.accept({ method: 'turn/started',
        params: { threadId: output.thread, turn: { id: output.turn } } }) : null;
      const value = projection.accept(message) ?? started;
      if (value) await broker.evaluate(value => window.fischLive.playgroundStatus?.(value), value).catch(() => {});
    },
    onRequest: message => { output.request(message); return broker?.client(message); } });
  broker = new LiveReactiveBroker({ page: live.page, provider: configured.provider, output, forward: transport.forward,
    reject: (message, error) => { output.accept({ id: message.id, error }); transport.reject(message, error); },
    log: text => { logs.push(text); logs.splice(0, Math.max(0, logs.length - 20)); } });
  await publishSetup('waiting');
  let child, stopping = false;
  const stop = () => { if (stopping) return; stopping = true; broker.close(); void stopChild(child).catch(() => {}); void transport.close().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    child = spawnClient(host.command, [...host.args, '--remote', transport.url, '--remote-auth-token-env', 'FISCH_CODEX_TRANSPORT_TOKEN', '--no-alt-screen', '-C', cwd],
      { cwd, env: { ...env, FISCH_CODEX_TRANSPORT_TOKEN: transport.token }, windowsHide: true, stdio: 'inherit' });
    const finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
    const timer = startLivePolling(live, output, broker, logs, stop);
    try { if (signal.aborted) stop(); return await finished; }
    finally { clearInterval(timer); }
  } finally {
    signal.removeEventListener('abort', stop); broker.close();
    await Promise.allSettled([stopChild(child), transport.close()]);
  }
}

function startLivePolling(live, output, broker, logs, stop) {
  return setInterval(() => {
    if (live.page.isClosed()) { stop(); return; }
    void broker.poll(output.sample(), logs.splice(0)).catch(stop);
  }, 100);
}
