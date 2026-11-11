import { setTimeout as delay } from 'node:timers/promises';
import { herdrCall } from '../integrations/herdr.mjs';
import { openLive, createLivePane } from '../integrations/live-launch.mjs';
import { OutputActivity } from '../integrations/output-activity.mjs';
import { openControl } from '../integrations/terminal-ipc.mjs';
import { runPanelCodex } from '../integrations/live-panel.mjs';
import { runTerminalCodex } from '../integrations/live-terminal.mjs';
import { liveShutdown, liveShutdownCode, closeLiveOwned } from '../integrations/live-shutdown.mjs';

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
export async function runLiveSession({ hands, assets, agentPane, panel = false, resumeThreadId, call = herdrCall, headless = false, signal, launchCodex = true, runHost, open = openLive } = {}) {
  if (signal?.aborted) return 130;
  const host = await selectLiveHost({ call, agentPane });
  const abort = new AbortController(), stop = kind => abort.abort(liveShutdown(kind));
  const userAbort = () => stop('abort'), fail = () => stop('failure');
  signal?.addEventListener('abort', userAbort, { once: true });
  process.once('SIGINT', userAbort); process.once('SIGTERM', userAbort);
  let live, control, failed = false;
  try {
    live = await open({ headless, signal: abort.signal, hands, assets });
    live.page.once('close', fail); live.page.once('crash', fail); live.gateway.once('exit', fail);
    await live.page.exposeFunction('fischLiveStop', reason => stop(reason === 'ui' ? 'ui' : 'failure'));
    if (abort.signal.aborted) return liveShutdownCode(abort.signal.reason) ?? 1;
    if (host.kind === 'terminal') {
      console.log(panel ? 'Fisch Live ready. Chat and Native approval requests are in the browser panel. Camera is off.' : 'Fisch Live ready. Camera is off. Codex runs in this terminal; exit Codex or close the body to stop.');
      return await (runHost ?? (panel ? runPanelCodex : runTerminalCodex))({ live, cwd: host.cwd, signal: abort.signal, ...(resumeThreadId ? { resumeThreadId } : {}) });
    }
    const source = host.source;
    const pane = launchCodex ? await createLivePane(call, source, live.base, live.token) : source;
    control = await openControl(pane.pane_id, liveControl(live, () => stop('ui')));
    console.log(`Fisch Live ready. Codex pane: ${pane.pane_id}. Camera is off; look is synthetic-only.`);
    console.log('Type in the dedicated Codex pane. The previous session is unchanged. Close the browser or use Dừng toàn bộ to stop Live.');
    await activityLoop(live, pane, call, abort.signal, process.env.FISCH_LIVE_RHYTHM === 'proxy');
    return abort.signal.aborted ? liveShutdownCode(abort.signal.reason) ?? 1 : 0;
  } catch (error) { failed = true; throw error; }
  finally {
    stop('cleanup'); process.removeListener('SIGINT', userAbort); process.removeListener('SIGTERM', userAbort);
    signal?.removeEventListener('abort', userAbort); await closeLiveOwned([() => control?.close(), () => live?.close()], failed);
  }
}
