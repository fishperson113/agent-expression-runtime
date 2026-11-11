import { expect, it, vi } from 'vitest';
import { startDesktopObserver } from '../integrations/desktop-observer.mjs';
import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';

function fixture() {
  let options, scheduled;
  const provider = { conversationLane: true, discardPublication: vi.fn() };
  const broker = { provider, active: { id: 'pending', controller: { abort: vi.fn() } },
    evaluate: vi.fn(async (fn, value) => fn(value)), poll: vi.fn(async () => {}), close: vi.fn() };
  const control = { base: 'http://127.0.0.1:2345', busy: vi.fn(() => false), close: vi.fn(async () => {}) };
  const api = { reactiveUserIntent: vi.fn(), externalObserverStatus: vi.fn() };
  const configure = vi.fn(() => ({ provider, reason: 'ready_native_conversation' }));
  vi.stubGlobal('window', { fischLive: api });
  return { provider, broker, control, api, configure, getOptions: () => options, scheduled: () => scheduled,
    input: { live: { page: { isClosed: () => false }, token: 'synthetic' }, env: {}, configure,
      intentServer: vi.fn(async value => { options = value; return control; }),
      brokerFactory: vi.fn(() => broker), schedule: vi.fn(fn => { scheduled = fn; return 123; }), unschedule: vi.fn(), log: vi.fn() } };
}
it('prepares one default Native provider and polls without inventing main activity or a conversation', async () => {
  const f = fixture();
  try {
    const observer = await startDesktopObserver(f.input);
    expect(f.configure).toHaveBeenCalledExactlyOnceWith(f.input.env, { defaultNative: true });
    expect(f.api.externalObserverStatus).toHaveBeenCalledWith('ready');
    expect(f.broker.poll).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(observer.controlBase).toBe(f.control.base);
    expect(f.input.brokerFactory.mock.calls[0][0].output).toBeUndefined();
    await observer.close(); await observer.close();
    expect(f.broker.close).toHaveBeenCalledOnce(); expect(f.control.close).toHaveBeenCalledOnce();
    expect(f.input.unschedule).toHaveBeenCalledWith(123);
  } finally { vi.unstubAllGlobals(); }
});
it('fences pending output at the known MCP boundary and pauses observer on uncertainty', async () => {
  const f = fixture();
  try {
    const observer = await startDesktopObserver(f.input);
    await f.getOptions().onBegin();
    expect(f.broker.active.controller.abort).toHaveBeenCalledOnce();
    expect(f.provider.discardPublication).toHaveBeenCalledWith('pending');
    expect(f.api.reactiveUserIntent).toHaveBeenCalledOnce();
    f.getOptions().onUncertain(); expect(f.broker.paused).toBe(true);
    await observer.close();
  } finally { vi.unstubAllGlobals(); }
});
it('retains explicit off/failure reasons and cleans resources on startup failure', async () => {
  const f = fixture(); f.configure.mockReturnValue({ provider: null, reason: 'disabled_by_config' });
  try {
    const observer = await startDesktopObserver(f.input);
    expect(f.api.externalObserverStatus).toHaveBeenCalledWith('disabled_by_config'); await observer.close();
    f.broker.evaluate.mockRejectedValue(Error('browser_failed'));
    await expect(startDesktopObserver(f.input)).rejects.toThrow('browser_failed');
    expect(f.control.close).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
it('broker external polling does not publish fake Native activity and respects an outstanding MCP lease', async () => {
  const api = { activity: vi.fn(() => { throw Error('no Native activity source'); }), configureReactive: vi.fn(),
    setReactiveUserBusy: vi.fn(), takeReactiveRequest: vi.fn(() => null) };
  vi.stubGlobal('window', { fischLive: api });
  const broker = new LiveReactiveBroker({ page: { evaluate: async (fn, arg) => fn(arg) },
    provider: { conversationLane: true, close: vi.fn() }, externalBusy: () => true });
  try {
    await broker.poll(undefined);
    expect(broker.browserUnavailable).toBe(false); expect(api.activity).not.toHaveBeenCalled();
    expect(api.setReactiveUserBusy).toHaveBeenCalledWith(true); expect(api.takeReactiveRequest).not.toHaveBeenCalled();
  } finally { broker.close(); vi.unstubAllGlobals(); }
});
