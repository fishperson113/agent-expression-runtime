import { createLiveReactiveProvider } from './live-reactive-provider.mjs';
import { LiveReactiveBroker } from './live-reactive-broker.mjs';
import { startDesktopIntentServer } from './desktop-intent.mjs';

export async function startDesktopObserver({ live, env = process.env, configured,
  configure = createLiveReactiveProvider, intentServer = startDesktopIntentServer,
  brokerFactory = options => new LiveReactiveBroker(options), schedule = setInterval,
  unschedule = clearInterval, onFailure = () => {}, log = text => console.error('Fisch observer: ' + text) } = {}) {
  configured ??= configure(env, { defaultNative: true });
  let control, timer, closed = false;
  const broker = brokerFactory({ page: live.page, provider: configured.provider, externalBusy: () => control?.busy() ?? false, log });
  const revoke = () => { broker.active?.controller.abort(); broker.provider?.discardPublication?.(broker.active?.id); };
  const tick = async () => {
    if (closed) return;
    if (live.page.isClosed()) { onFailure(); return; }
    await broker.poll(undefined);
    if (broker.browserUnavailable) onFailure();
  };
  try {
    control = await intentServer({ token: live.token,
      onBegin: async () => { revoke(); await broker.evaluate(() => window.fischLive.reactiveUserIntent(), undefined, 'user_barrier'); },
      onUncertain: () => { revoke(); broker.paused = true; log('external_intent_uncertain_restart_observer'); } });
    await broker.evaluate(reason => window.fischLive.externalObserverStatus(reason), configured.provider ? 'ready' : configured.reason);
    await tick();
    timer = schedule(() => { void tick().catch(onFailure); }, 100);
    return { controlBase: control.base, configured, broker,
      close: async () => { if (closed) return; closed = true; unschedule(timer); try { broker.close(); } finally { await control.close(); } } };
  } catch (error) { closed = true; unschedule(timer); try { broker.close(); } finally { await control?.close(); } throw error; }
}
