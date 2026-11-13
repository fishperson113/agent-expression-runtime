import { fischCodexRuntime } from './fisch-codex-runtime.mjs';
import { spawn } from 'node:child_process';
import { captureChatObservation } from './chat-observation.mjs';
import { nativeLiveInstructions } from './live-instruction-bundle.mjs';
import { randomUUID } from 'node:crypto';
import { liveCodexArguments } from '../scripts/live-codex.mjs';
import { codexCommand, stopChild } from '../scripts/start-session.mjs';
import { openCodexTransport } from './live-codex-transport.mjs';
import { LiveReactiveBroker } from './live-reactive-broker.mjs';
import { createLiveReactiveProvider, nativeLiveEnvironment } from './live-reactive-provider.mjs';
import { LiveOutput } from './live-output.mjs';
import { LiveConversation, bindLiveConversation } from './live-conversation.mjs';
import { PlaygroundProjection } from './playground-projection.mjs';
import { liveSetupStatus } from './live-setup-status.mjs';
import { liveRoot } from './live-launch.mjs';
import { liveShutdownCode, closeLiveOwned } from './live-shutdown.mjs';

async function selectThread(state, thread, previous) {
  state.projection.select(thread);
  if (!state.channel.stale) state.channel.token = randomUUID();
  await state.broker.evaluate(async ({ token, snapshot, clear }) => {
    const api = window.fischLive; if (api.conversationOffline === true) return;
    api.conversationDocument = token; await api.selectThread();
    if (api.conversationOffline === true) return;
    if (clear) { api.playgroundClear?.(); api.conversationClear?.(); }
    api.conversationStatus?.(snapshot);
  }, { ...state.publication(), clear: !!previous });
  await state.publishSetup('connected');
}
async function observeMessage(state, message) {
  await state.output.accept(message); state.broker.event(message); state.conversation.accept(message);
  const started = state.output.turn ? state.projection.accept({ method: 'turn/started',
    params: { threadId: state.output.thread, turn: { id: state.output.turn } } }) : null;
  const value = state.projection.accept(message) ?? started;
  if (value) await state.broker.evaluate(value => window.fischLive.playgroundStatus?.(value), value).catch(() => {});
}
export async function createBridge({ live, host, cwd, env, configured, instructions }) {
  const state = { logs: [], projection: new PlaygroundProjection(), channel: { token: randomUUID(), stale: false } };
  state.output = new LiveOutput((thread, previous) => selectThread(state, thread, previous));
  const original = liveCodexArguments(liveRoot, cwd, env), config = original.slice(original.indexOf('-c'));
  try {
    state.transport = await openCodexTransport({ host, args: config, cwd, env, instructions,
      onEvent: message => observeMessage(state, message), onFailure: () => state.fail?.(1),
      onRequest: message => {
        state.conversation?.inputAttempt(message);
        if (['thread/start', 'thread/resume', 'thread/fork'].includes(message.method)) state.conversation?.selectionAttempt();
        state.output.request(message); return state.broker?.client(message);
      } });
    state.broker = new LiveReactiveBroker({ page: live.page, provider: configured.provider, output: state.output,
      forward: state.transport.forward, contextSource: () => state.conversation?.observerContext() ?? null, beforeForward: (message, source) => { state.conversation?.fenceObservation(message.id, source); state.conversation?.prepareSceneContext(message.id, source?.documentToken === state.channel.token ? source : null); }, reject: (message, error) => {
        const rejected = { id: message.id, error }; state.output.accept(rejected); state.conversation?.accept(rejected); state.transport.reject(message, error);
      }, log: text => { state.logs.push(text); state.logs.splice(0, Math.max(0, state.logs.length - 20)); } });
    state.conversation = new LiveConversation({ output: state.output, transport: state.transport, broker: state.broker, captureObservation: scope => captureChatObservation(state.broker, state.channel, scope) });
    state.publishSetup = (native, token) => state.broker.evaluate(({ value, token }) => {
      const api = window.fischLive; if (api.conversationOffline === true) return;
      if (token) api.conversationDocument = token; api.setupStatus?.(value);
    }, { value: liveSetupStatus(native, configured), token }).catch(() => {});
    state.publication = () => ({ token: state.channel.token, snapshot: state.channel.stale
      ? { ...state.conversation.snapshot(), available: false, canSend: false, canCancel: false, error: 'conversation_restart_required' }
      : state.conversation.snapshot() });
    return state;
  } catch (error) { await closeLiveOwned([() => state.broker?.close(), () => state.transport?.close()], true); throw error; }
}

export async function runTerminalCodex({ live, cwd, signal, spawnClient = spawn, host: suppliedHost, reactiveProvider }) {
  const host = suppliedHost ?? await codexCommand();
  const runtime = fischCodexRuntime(); cwd = runtime.cwd;
  const env = { ...nativeLiveEnvironment(runtime.env), AER_BASE_URL: live.base, AER_PAIRING_TOKEN: live.token, FISCH_LIVE: '1', FISCH_PLANNER_BACKEND: 'off' };
  const configured = reactiveProvider === undefined ? createLiveReactiveProvider(runtime.env, { defaultNative: true }) : { provider: reactiveProvider, reason: reactiveProvider ? 'ready' : 'disabled_by_config' };
  const instructions = nativeLiveInstructions();
  const state = await createBridge({ live, host, cwd, env, configured, instructions });
  let child, stopping = false, stoppedCode = 1, closing, failed = false;
  const cleanupFailure = Promise.withResolvers(); void cleanupFailure.promise.catch(() => {});
  const cleanup = () => closing ??= closeLiveOwned([() => state.unbind?.(), () => stopChild(child), () => state.transport.close()]);
  const closeConversation = () => { state.channel.stale = true; state.channel.token = undefined; state.conversation.close(); };
  const stop = code => { if (stopping) return; stopping = true; stoppedCode = state.broker.browserUnavailable ? 1 : code;
    closeConversation(); state.broker.close(); void cleanup().catch(cleanupFailure.reject); };
  state.fail = stop;
  const onAbort = () => stop(liveShutdownCode(signal.reason) ?? 130);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    state.unbind = await bindLiveConversation(live.page, { send: value => state.conversation.send(value), cancel: value => state.conversation.cancel(value),
      authorizeObserverContext: id => state.broker.authorizeObserverContext(id),
      navigation: () => { state.channel.stale = true; state.channel.token = undefined; state.conversation.navigation(); } });
    await state.publishSetup('waiting', state.channel.token);
    child = spawnClient(host.command, [...host.args, '--remote', state.transport.url, '--remote-auth-token-env', 'FISCH_CODEX_TRANSPORT_TOKEN', '--no-alt-screen', '-C', cwd],
      { cwd, env: { ...env, FISCH_CODEX_TRANSPORT_TOKEN: state.transport.token }, windowsHide: true, stdio: 'inherit' });
    const finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(stopping ? stoppedCode : state.broker.browserUnavailable ? 1 : code ?? 1)); });
    const timer = startLivePolling(live, state, () => stop(1));
    try { if (signal.aborted) onAbort(); return await Promise.race([finished, cleanupFailure.promise]); }
    finally { clearInterval(timer); }
  } catch (error) { failed = true; throw error; }
  finally { signal.removeEventListener('abort', onAbort); closeConversation(); state.broker.close(); await closeLiveOwned([cleanup], failed); }
}
export function startLivePolling(live, state, stop) {
  return setInterval(() => {
    if (live.page.isClosed()) { stop(); return; }
    void state.broker.poll(state.output.sample(), state.logs.splice(0), state.publication)
      .then(() => { if (state.broker.browserUnavailable) stop(); }, stop);
  }, 100);
}
