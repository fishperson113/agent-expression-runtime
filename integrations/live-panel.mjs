import { nativeLiveInstructions } from './live-instruction-bundle.mjs';
import { codexCommand } from '../scripts/start-session.mjs';
import { createBridge, startLivePolling } from './live-terminal.mjs';
import { createLiveReactiveProvider, nativeLiveEnvironment } from './live-reactive-provider.mjs';
import { bindLiveConversation } from './live-conversation.mjs';
import { liveShutdownCode, closeLiveOwned } from './live-shutdown.mjs';
import { openPanelClient } from './panel-client.mjs';

export function startupFeedback(error) {
  if (Number.isSafeInteger(error?.rpcError?.code)) return { type: 'startup_failed', code: error.rpcError.code };
  const phase = error?.startupPhase;
  if (!['connect', 'initialize', 'thread/start', 'thread/resume'].includes(phase)) return;
  const reason = ['panel_rpc_timeout', 'panel_connect_timeout'].includes(error.message) ? 'timeout'
    : ['panel_connect_failed', 'panel_connect_closed', 'panel_closed', 'panel_rpc_unavailable', 'panel_write_unknown'].includes(error.message) ? 'connection' : null;
  if (reason) return { type: 'startup_unavailable', phase, reason };
}

async function bindControls(live, state, respond) {
  const expected = live.page.url(), frame = live.page.mainFrame();
  await live.page.exposeBinding('fischPanelRespond', (source, value) => {
    if (source.page !== live.page || source.frame !== frame || frame.url() !== expected || live.page.isClosed() || state.channel.stale)
      throw Error('panel_control_source_rejected');
    return respond(value);
  });
}
function panelPublication(state, value) {
  state.controlPending ??= 0;
  if (state.controlPending >= 64) { state.fail?.(1); return Promise.resolve(); }
  state.controlPending++;
  return state.controlTail = (state.controlTail ?? Promise.resolve()).then(() => {
    if (state.channel.stale || state.broker.closed) return;
    const token = state.channel.token;
    return state.broker.evaluate(({ token, value }) => {
      const api = window.fischLive;
      if (api.conversationDocument === token) api.panelControlStatus?.(value);
    }, { token, value });
  }).catch(() => state.fail?.(1)).finally(() => { state.controlPending--; });
}
async function keepDisconnectedPanel(state, client, signal, page) {
  state.conversation.transportLost();
  const token = state.channel.token, snapshot = state.conversation.snapshot();
  state.channel.stale = true; state.broker.close();
  await closeLiveOwned([() => client?.close(), () => state.transport.close()], true);
  if (signal.aborted) return 1;
  let timer;
  try {
    const published = await Promise.race([page.evaluate(async ({ token, snapshot }) => {
      const api = window.fischLive;
      if (api.conversationDocument !== token || typeof api.conversationStatus !== 'function') return false;
      api.conversationOffline = true; api.conversationDocument = null; api.configureReactive?.(false);
      await api.reactiveUserIntent?.();
      api.conversationStatus(snapshot); api.setupStatus?.({ native: 'unavailable', observer: 'unavailable' });
      api.panelControlStatus?.({ type: 'offline' }); return true;
    }, { token, snapshot }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('panel_disconnect_publication_failed')), 10000); })]);
    if (!published) throw Error('panel_disconnect_publication_failed');
  } catch { throw Error('panel_disconnect_publication_failed'); }
  finally { clearTimeout(timer); }
  await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
  return 1;
}
export async function runPanelCodex({ live, cwd, signal, host: suppliedHost, reactiveProvider, resumeThreadId, clientFactory = openPanelClient }) {
  if (signal?.aborted) return liveShutdownCode(signal.reason) ?? 130;
  const host = suppliedHost ?? await codexCommand();
  const env = { ...nativeLiveEnvironment(process.env), AER_BASE_URL: live.base, AER_PAIRING_TOKEN: live.token, FISCH_LIVE: '1', FISCH_PLANNER_BACKEND: 'off' };
  const configured = reactiveProvider === undefined ? createLiveReactiveProvider(process.env, { defaultNative: true }) : { provider: reactiveProvider, reason: reactiveProvider ? 'ready' : 'disabled_by_config' };
  const instructions = nativeLiveInstructions();
  const state = await createBridge({ live, host, cwd, env, configured, instructions });
  const done = Promise.withResolvers(); let client, timer, unbind, failed = false;
  state.fail = code => done.resolve(code);
  const onAbort = () => {
    state.channel.stale = true; state.conversation.close(); state.broker.close();
    done.resolve(liveShutdownCode(signal.reason) ?? 130); void state.transport.close().catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) return liveShutdownCode(signal.reason) ?? 130;
    unbind = await bindLiveConversation(live.page, { send: value => state.conversation.send(value), cancel: value => state.conversation.cancel(value),
      authorizeObserverContext: id => state.broker.authorizeObserverContext(id),
      navigation: () => { state.channel.stale = true; state.channel.token = undefined; state.conversation.navigation(); try { client?.close(); } catch { state.fail(1); } } });
    await bindControls(live, state, value => client?.respond(value) ?? Promise.reject(Error('panel_not_ready')));
    await state.publishSetup('waiting', state.channel.token); await panelPublication(state, { type: 'mode' });
    client = await clientFactory({ url: state.transport.url, token: state.transport.token, cwd, resumeThreadId,
      onControl: value => { void panelPublication(state, value); }, onFailure: () => state.fail(1) });
    if (state.output.thread !== client.threadId) throw Error('panel_thread_not_selected');
    await state.publishSetup('connected');
    await panelPublication(state, { type: 'ready', threadId: client.threadId });
    timer = startLivePolling(live, state, () => state.fail(1));
    if (signal.aborted) onAbort();
    const code = await done.promise;
    if (code !== 1 || signal.aborted || state.broker.browserUnavailable || state.channel.stale) return code;
    failed = true; clearInterval(timer);
    return await keepDisconnectedPanel(state, client, signal, live.page);
  } catch (error) {
    if (signal.aborted) return liveShutdownCode(signal.reason) ?? 130;
    failed = true;
    const feedback = startupFeedback(error);
    if (state.output.thread || !feedback || state.broker.browserUnavailable) throw error;
    state.conversation.startupFailed();
    const token = state.channel.token, snapshot = state.conversation.snapshot();
    try {
      const published = await state.broker.evaluate(({ token, feedback, snapshot }) => {
        const api = window.fischLive;
        if (api.conversationDocument !== token || typeof api.conversationStatus !== 'function' || typeof api.panelControlStatus !== 'function') return false;
        api.conversationStatus(snapshot); api.panelControlStatus(feedback);
        api.setupStatus?.({ native: 'unavailable', observer: 'unavailable' });
        api.configureReactive?.(false); return true;
      }, { token, feedback, snapshot });
      if (!published) throw Error('panel_startup_publication_failed');
    } finally {
      state.channel.stale = true; state.broker.close();
      await closeLiveOwned([() => client?.close(), () => state.transport.close()], true);
    }
    // Connection closure can settle `done`; only an explicit Stop ends this offline screen.
    await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
    return 1;
  }
  finally {
    clearInterval(timer); signal.removeEventListener('abort', onAbort); state.channel.stale = true;
    state.conversation.close(); state.broker.close();
    await closeLiveOwned([() => unbind?.(), () => client?.close(), () => state.transport.close()], failed);
  }
}
