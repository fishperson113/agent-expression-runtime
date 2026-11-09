import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { liveCodexArguments } from '../scripts/live-codex.mjs';
import { codexCommand, stopChild } from '../scripts/start-session.mjs';
import { openCodexTransport } from './live-codex-transport.mjs';
import { LiveReactivity } from './live-reactivity.mjs';
import { LiveOutput } from './live-output.mjs';
import { LiveChat, bindLiveChat } from './live-chat.mjs';
import { liveRoot } from './live-launch.mjs';

export async function runTerminalCodex({ live, cwd, signal, spawnClient = spawn }) {
  const host = await codexCommand(), output = new LiveOutput(() => live.page.evaluate(() => window.fischLive.selectThread()));
  const original = liveCodexArguments(liveRoot, cwd), config = original.slice(original.indexOf('-c'));
  const env = { ...process.env, AER_BASE_URL: live.base, AER_PAIRING_TOKEN: live.token, FISCH_LIVE: '1', FISCH_PLANNER_BACKEND: 'off' };
  const instructions = readFileSync(new URL('./live-instructions.md', import.meta.url), 'utf8') +
    '\nOpt-in fisch_local_observation tool outputs are local geometric event notices, not user requests. ' +
    'For fresh meaningful events, choose a brief coordinated Fisch observe/express response, with short natural text when useful. ' +
    'Stay quiet for stale, duplicate or unsupported events. Do not demand typing. Never run commands, edit files or contact external parties. ' +
    'Do not infer emotion or intent. No image/audio is included. User turns always take priority; idle timers never request inference.';
  const logs = []; let reactor, chat;
  const transport = await openCodexTransport({ host, args: config, cwd, env, instructions,
    onEvent: async message => { await output.accept(message); chat?.accept(message); reactor?.event(message); },
    onRequest: message => { output.request(message);
      if (['thread/start', 'thread/resume', 'thread/fork'].includes(message.method)) chat?.selection();
      return reactor?.client(message); } });
  reactor = new LiveReactivity({ output, request: transport.request, forward: transport.forward, reject: transport.reject,
    log: text => { logs.push(text); logs.splice(0, Math.max(0, logs.length - 20)); } });
  chat = new LiveChat({ output, transport, reactor });
  let child;
  const stop = () => { chat.close(); reactor.close(); void stopChild(child).catch(() => {}); void transport.close().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    await bindLiveChat(live.page, chat);
    child = spawnClient(host.command, [...host.args, '--remote', transport.url, '--remote-auth-token-env', 'FISCH_CODEX_TRANSPORT_TOKEN', '--no-alt-screen', '-C', cwd],
      { cwd, env: { ...env, FISCH_CODEX_TRANSPORT_TOKEN: transport.token }, windowsHide: true, stdio: 'inherit' });
    const finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
    const timer = startLivePolling(live, output, reactor, logs, stop, chat);
    try { if (signal.aborted) stop(); return await finished; }
    finally { clearInterval(timer); }
  } finally {
    signal.removeEventListener('abort', stop); chat.close(); reactor.close();
    await Promise.allSettled([stopChild(child), transport.close()]);
  }
}

function startLivePolling(live, output, reactor, logs, stop, chat) {
  let polling = false;
  return setInterval(() => {
    if (polling || live.page.isClosed()) return;
    polling = true;
    void live.page.evaluate(({ activity, entries, conversation }) => {
      window.fischLive.chat?.(conversation);
      window.fischLive.activity(activity);
      for (const text of entries) window.fischLive.logActivity?.(text);
      return window.fischLive.reactivity?.();
    }, { activity: output.sample(), entries: logs.splice(0), conversation: chat.snapshot() })
      .then(value => reactor.sample(value)).catch(stop).finally(() => { polling = false; });
  }, 100);
}
