import { readFileSync } from 'node:fs';
import { codexCommand } from '../scripts/start-session.mjs';
import { createBridge, startLivePolling } from './live-terminal.mjs';
import { createLiveReactiveProvider, nativeLiveEnvironment } from './live-reactive-provider.mjs';
import { bindLiveConversation } from './live-conversation.mjs';
import { liveShutdownCode, closeLiveOwned } from './live-shutdown.mjs';
import { openPanelClient } from './panel-client.mjs';

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
export async function runPanelCodex({ live, cwd, signal, host: suppliedHost, reactiveProvider, resumeThreadId, clientFactory = openPanelClient }) {
  if (signal?.aborted) return liveShutdownCode(signal.reason) ?? 130;
  const host = suppliedHost ?? await codexCommand();
  const env = { ...nativeLiveEnvironment(process.env), AER_BASE_URL: live.base, AER_PAIRING_TOKEN: live.token, FISCH_LIVE: '1', FISCH_PLANNER_BACKEND: 'off' };
  const configured = reactiveProvider === undefined ? createLiveReactiveProvider(process.env, { defaultNative: true }) : { provider: reactiveProvider, reason: reactiveProvider ? 'ready' : 'disabled_by_config' };
  const instructions = readFileSync(new URL('./live-instructions.md', import.meta.url), 'utf8');
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
    return await done.promise;
  } catch (error) { if (signal.aborted) return liveShutdownCode(signal.reason) ?? 130; failed = true; throw error; }
  finally {
    clearInterval(timer); signal.removeEventListener('abort', onAbort); state.channel.stale = true;
    state.conversation.close(); state.broker.close();
    await closeLiveOwned([() => unbind?.(), () => client?.close(), () => state.transport.close()], failed);
  }
}
