import { afterEach, expect, it, vi } from 'vitest';
import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const receipt = (id = 'request') => ({ requestId: id, modelConfigHash: 'a'.repeat(64), promptHash: 'b'.repeat(64), requestHash: 'c'.repeat(64),
  responseHash: null, outcome: 'transport_unknown', durationMs: null, usage: 'unknown' });
function fixture() {
  const state = { token: { runId: 'capture', generation: 1 }, callbacks: [], received: [], forwarded: [], evaluations: 0 }, candidates = [];
  const request = { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'request', intentRevision: 0, presenceRevision: 1, deadline: 1000, requiredTrackIds: [] };
  const candidate = { request, observationWindow: { schemaVersion: 1, request,
    events: [{ id: 1, type: 'user_arrived', at: 100 }], observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100,
      camera: 'absent', turn: 'idle', summary: 'local', user: { present: false, quality: { score: 0, basis: 'unavailable' },
        position: null, head: null, expression: null, facingScreen: null, mouthMoving: null } }] } };
  const api = { activity() {}, configureReactive() {}, setReactiveUserBusy() {}, takeReactiveRequest: () => candidates.shift() ?? null,
    authorizeReactiveRequest: () => true, deliverReactiveDecision() {}, failReactiveDecision() {}, reactiveUserIntent() {},
    recordingCaptureToken: () => state.token, recordProviderReceipt: (token, value) => {
      if (state.token && token.runId === state.token.runId && token.generation === state.token.generation) state.received.push(value);
    } };
  const page = { evaluate: async (fn, arg) => { state.evaluations++; const old = globalThis.window; globalThis.window = { fischLive: api };
    try { return await fn(arg); } finally { globalThis.window = old; } } };
  const provider = { decide: (_window, _signal, callback) => { state.callbacks.push(callback); return new Promise(resolve => { state.resolve = resolve; }); } };
  const broker = new LiveReactiveBroker({ page, provider, output: { thread: 'native' }, forward: value => state.forwarded.push(value), reject() {} });
  return { state, api, broker, candidate, candidates, start: async () => { candidates.push(candidate); await broker.poll({}); await flush(); } };
}
afterEach(() => { vi.useRealTimers(); });
it('queues strict receipts without extra evaluate and flushes only on the existing poll', async () => {
  const f = fixture(); await f.start(); const before = f.state.evaluations;
  f.state.callbacks[0](receipt()); f.state.callbacks[0](receipt());
  expect(f.state.evaluations).toBe(before); expect(f.broker.providerReceipts).toHaveLength(1);
  await f.broker.poll({}); expect(f.state.evaluations).toBe(before + 1); expect(f.state.received).toEqual([receipt()]);
  f.broker.close();
});
it('omits the callback while capture is off and never backfills old run receipts after opt-in changes', async () => {
  const off = fixture(); off.state.token = null; await off.start(); expect(off.state.callbacks[0]).toBeUndefined(); off.broker.close();
  const f = fixture(); await f.start(); f.state.callbacks[0](receipt());
  f.state.token = { runId: 'new_capture', generation: 2 }; await f.broker.poll({}); expect(f.state.received).toEqual([]);
  expect(f.broker.providerReceipts).toEqual([]); f.broker.close();
});
it('bounds the queue, ignores invalid metadata and contains synchronous or asynchronous browser sink failures', async () => {
  const f = fixture(); const token = f.state.token;
  for (let i = 0; i < 20; i++) f.broker.receipt({ id: 'r' + i, captureToken: token, receiptSeen: false }, receipt('r' + i));
  expect(f.broker.providerReceipts).toHaveLength(8);
  f.broker.receipt({ id: 'bad', captureToken: token }, { ...receipt('bad'), body: 'PRIVATE' });
  expect(JSON.stringify(f.broker.providerReceipts)).not.toContain('PRIVATE');
  f.api.recordProviderReceipt = () => { throw Error('sink'); }; await f.broker.poll({}); expect(f.broker.paused).toBe(false);
  f.broker.receipt({ id: 'later', captureToken: token }, receipt('later'));
  f.api.recordProviderReceipt = async () => { throw Error('async sink'); }; await f.broker.poll({}); await flush();
  expect(f.broker.browserUnavailable).toBe(false); f.broker.close();
});
it('allows late metadata after timeout without reviving actions or competing with the user barrier', async () => {
  vi.useFakeTimers(); const f = fixture(); await f.start(); const callback = f.state.callbacks[0];
  await vi.advanceTimersByTimeAsync(30000); callback(receipt()); await f.broker.poll({});
  expect(f.state.received).toEqual([receipt()]); expect(f.broker.uncertain).toBe(true);
  f.broker.client({ id: 1, method: 'turn/start', params: { threadId: 'native' } }); await flush();
  expect(f.state.forwarded).toHaveLength(1); f.state.resolve({ mode: 'express' }); await flush();
  expect(f.broker.active.terminal).toBe(true); f.broker.close(); callback(receipt()); expect(f.broker.providerReceipts).toEqual([]);
});
it('rechecks capture binding during the existing authorization call and omits hashing when capture stops before HTTP', async () => {
  const f = fixture(); f.api.authorizeReactiveRequest = () => { f.state.token = null; return true; };
  await f.start(); expect(f.state.callbacks[0]).toBeUndefined(); expect(f.broker.active).toBeDefined();
  expect(f.state.evaluations).toBe(2); f.broker.close();
});
