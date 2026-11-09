import { setTimeout as delay } from 'node:timers/promises';
import { herdrCall } from '../integrations/herdr.mjs';
import { openLive, createLivePane } from '../integrations/live-launch.mjs';
import { OutputActivity } from '../integrations/output-activity.mjs';
import { openControl } from '../integrations/terminal-ipc.mjs';
import { runTerminalCodex } from '../integrations/live-terminal.mjs';

export async function selectLiveHost({ env = process.env, cwd = process.cwd(), call = herdrCall, agentPane } = {}) {
  if (!agentPane) return { kind: 'terminal', cwd };
  try {
    const { snapshot } = await call('session.snapshot');
    return { kind: 'herdr', source: selectLiveSource(snapshot, agentPane, env.HERDR_PANE_ID) };
  } catch (error) {
    if (agentPane) throw error;
    return { kind: 'terminal', cwd };
  }
}

export function selectLiveSource(snapshot, requested, paneId = process.env.HERDR_PANE_ID) {
  const candidates = snapshot.agents.filter(agent => agent.agent === 'codex' && (!requested || agent.pane_id === requested));
  if (!requested) {
    const own = snapshot.panes?.find(pane => pane.pane_id === paneId) ??
      snapshot.panes?.find(pane => pane.pane_id === snapshot.focused_pane_id);
    if (own) return own;
  }
  if (candidates.length === 1) return candidates[0];
  throw Object.assign(Error('Open a Herdr shell and run fisch live.'), { public: true });
}
export function liveControl(live, stop) {
  let delivered = 0;
  return async message => {
    if (message.method === 'stop') { stop(); return { status: 'stopped' }; }
    if (message.method === 'status') return { status: 'live', lookMode: 'synthetic-only', hookEvents: delivered };
    if (message.method !== 'event' || !['user_message', 'needs_user', 'interrupted', 'work_finished'].includes(message.args?.type)) return { status: 'ignored' };
    await live.page.evaluate(type => window.fischLive.event(type), message.args.type); delivered++;
    return { status: 'accepted' };
  };
}
async function activityLoop(live, pane, call, signal, proxy) {
  const output = new OutputActivity(); let status = 'idle', tick = 0;
  while (!signal.aborted && !live.page.isClosed()) {
    if (tick++ % 10 === 0) {
      const { snapshot } = await call('session.snapshot');
      const current = snapshot.panes.find(item => item.pane_id === pane.pane_id);
      if (!current) break;
      status = { working: 'working', blocked: 'waiting' }[current.agent_status] ?? 'idle';
    }
    let value = 0;
    if (proxy) {
      const result = await call('pane.read', { pane_id: pane.pane_id, source: 'recent-unwrapped', lines: 80, format: 'text', strip_ansi: true });
      value = output.sample(result.read.text, performance.now(), status === 'working');
    }
    await live.page.evaluate(({ turn, output, quality }) => window.fischLive.activity({ turn, output, quality }),
      { turn: status, output: value, quality: proxy ? 'experimental-pane-proxy' : 'off' });
    await delay(100, undefined, { signal }).catch(() => {});
  }
}
export async function runLiveSession({ hands, assets, agentPane, call = herdrCall, headless = false, signal, launchCodex = true, runHost = runTerminalCodex, open = openLive } = {}) {
  if (signal?.aborted) return 130;
  const host = await selectLiveHost({ call, agentPane });
  const abort = new AbortController(), stop = () => abort.abort();
  signal?.addEventListener('abort', stop, { once: true });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let live, control;
  try {
    live = await open({ headless, signal: abort.signal, hands, assets });
    live.page.once('close', stop); live.gateway.once('exit', stop);
    await live.page.exposeFunction('fischLiveStop', stop);
    if (abort.signal.aborted) return 130;
    if (host.kind === 'terminal') {
      console.log('Fisch Live ready. Camera is off. Codex runs in this terminal; exit Codex or close the body to stop.');
      return await runHost({ live, cwd: host.cwd, signal: abort.signal });
    }
    const source = host.source;
    const pane = launchCodex ? await createLivePane(call, source, live.base, live.token) : source;
    control = await openControl(pane.pane_id, liveControl(live, stop));
    console.log(`Fisch Live ready. Codex pane: ${pane.pane_id}. Camera is off; look is synthetic-only.`);
    console.log('Type in the dedicated Codex pane. The previous session is unchanged. Close the browser or use Dừng toàn bộ to stop Live.');
    await activityLoop(live, pane, call, abort.signal, process.env.FISCH_LIVE_RHYTHM === 'proxy');
    return 0;
  } finally {
    stop(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    signal?.removeEventListener('abort', stop); await control?.close(); await live?.close();
  }
}
