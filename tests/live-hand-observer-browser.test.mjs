import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { freezeReactiveCandidate, freezeReactiveWindow } from '../integrations/reactive-window.mjs';
import { reactiveResponsesAdapter } from '../integrations/reactive-provider.mjs';

let server, browser;
beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
afterAll(async () => { await browser?.close(); await server?.close(); });
async function fixture(version) {
  const page = await browser.newPage();
  await page.clock.install({ time: new Date('2026-11-09T12:00:00Z') });
  await page.goto(server.resolvedUrls.local[0] + 'live.html?fixture=synthetic'); await page.waitForFunction(() => !!window.fischLive);
  await page.clock.pauseAt(new Date('2026-11-09T12:00:30Z'));
  await page.evaluate(version => {
    window.fischLive.configureReactive(true, version);
    const checkbox = document.querySelector('#enable-reactivity'); checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
    window.fischLive.startRecording();
  }, version);
  return page;
}
async function samples(page, count, mode = 'hand-only', from = 0.2, step = 0) {
  for (let i = 0; i < count; i++) {
    await page.clock.runFor(50);
    await page.evaluate(({ mode, x }) => window.fischLive.fixture(mode, x), { mode, x: from + i * step });
  }
}
async function take(page) {
  const candidate = await page.evaluate(() => window.fischLive.takeReactiveRequest());
  expect(candidate).not.toBeNull(); freezeReactiveCandidate(candidate); freezeReactiveWindow(candidate.observationWindow);
  expect(await page.evaluate(id => window.fischLive.authorizeReactiveRequest(id), candidate.request.requestId)).toBe(true);
  return candidate;
}
function fakeProvider(defer = false) {
  let entered; const ready = new Promise(resolve => { entered = resolve; });
  const state = { reserves: 0, fetches: 0, inputs: [] };
  const provider = reactiveResponsesAdapter({ enabled: true, model: 'fixture-only', endpoint: 'http://127.0.0.1:1/v1/responses' }, {
    reserve: async () => { state.reserves++; return true; }, fetch: async (_url, options) => {
      state.fetches++; const request = JSON.parse(options.body), evidence = JSON.parse(request.input); state.inputs.push(evidence);
      expect(request.tools).toEqual([]); expect(request.tool_choice).toBe('none'); expect(request.store).toBe(false);
      const value = { schemaVersion: 1, requestId: evidence.request.requestId, decisionId: 'browser_hand_decision', mode: 'express',
        validUntil: evidence.request.deadline, action: { actionId: 'browser_hand_action', body: { type: 'sequence', children: [{ type: 'parallel', children: [
          { type: 'morph', target: 'sphere', durationMs: 500 },
          { type: 'shapeQuality', rise: 0.15, grow: 1.1, effort: { time: 0.5, weight: 0.4, flow: 0.7 }, durationMs: 500 },
        ] }] } } };
      const response = new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }));
      if (defer) return new Promise(resolve => { state.release = () => resolve(response); entered(); });
      entered(); return response;
    },
  });
  return { provider, state, ready };
}
async function deliver(page, candidate, decision) {
  return page.evaluate(({ id, data }) => window.fischLive.deliverReactiveDecision(id, data), { id: candidate.request.requestId, data: decision });
}
const reactiveEvents = value => value.diagnostics.events.filter(event => event.origin === 'reactive');
it('keeps hand-only input inert with the legacy omitted capability version', async () => {
  const page = await fixture(undefined), { state } = fakeProvider();
  try {
    await samples(page, 32, 'hand-only', 0.2, 0.01);
    expect(await page.evaluate(() => window.fischLive.takeReactiveRequest())).toBeNull();
    const status = await page.evaluate(() => window.fischLive.reactiveStatus()); expect(status.dispatches).toBe(0);
    expect(state.reserves).toBe(0); expect(state.fetches).toBe(0);
  } finally { await page.close(); }
}, 30000);
it('runs hand-only typed evidence through the actual adapter and Body admission/application/frame proxies', async () => {
  const page = await fixture(1), { provider, state } = fakeProvider();
  try {
    await samples(page, 22, 'hand-only', 0.2, 0.01); const candidate = await take(page);
    expect(candidate.observationWindow.events.some(event => event.type === 'hand_motion_started')).toBe(true);
    for (const observation of candidate.observationWindow.observations) {
      expect(observation.user.present).toBe(false); expect(observation.camera).toBe('absent');
      expect(observation.hands.entities[0].landmarks).toHaveLength(21);
    }
    expect(candidate.request.handReadSet.primaryTrackId).toBe(candidate.request.requiredTrackIds[0]);
    const decision = await provider.decide(candidate.observationWindow, new AbortController().signal);
    expect((await deliver(page, candidate, decision)).reason).toBe('accepted'); await samples(page, 12, 'hand-only', 0.42, 0.01);
    const metrics = await page.evaluate(() => window.fischLive.metrics()), phases = reactiveEvents(metrics).map(event => event.phase);
    expect(phases).toEqual(expect.arrayContaining(['admitted', 'applied', 'frame_submitted', 'frame_changed_proxy', 'completed']));
    expect(metrics.cameraActive).toBe(false); expect(metrics.syntheticFixture).toBe(true);
    expect(state.reserves).toBe(1); expect(state.fetches).toBe(1); expect(JSON.stringify(state.inputs)).not.toContain('summary');
    expect(await page.locator('#camera').evaluate(video => video.srcObject)).toBeNull();
  } finally { await page.close(); }
}, 30000);
it('drops a delayed valid lost-hand response on the first return before appearance debounce', async () => {
  const page = await fixture(1), { provider, state, ready } = fakeProvider(true);
  try {
    await samples(page, 4); await samples(page, 23, 'hand-lost'); const candidate = await take(page);
    expect(candidate.request.handReadSet.primaryTrackId).toBeNull();
    expect(candidate.observationWindow.events.map(event => event.type)).toEqual(['hand_lost']);
    const beforeReturn = await page.evaluate(() => window.fischLive.recordingSnapshot().records.filter(record => record.kind === 'event' && record.payload.type === 'hand_appeared').length);
    const pending = provider.decide(candidate.observationWindow, new AbortController().signal); void pending.catch(() => {}); await ready;
    await samples(page, 1); state.release(); const result = await deliver(page, candidate, await pending);
    expect(['stale', 'revoked']).toContain(result.reason);
    const metrics = await page.evaluate(() => window.fischLive.metrics());
    expect(reactiveEvents(metrics).some(event => ['admitted', 'applied'].includes(event.phase))).toBe(false);
    const recording = await page.evaluate(() => window.fischLive.recordingSnapshot());
    expect(recording.records.filter(record => record.kind === 'event' && record.payload.type === 'hand_appeared')).toHaveLength(beforeReturn);
    expect((await page.evaluate(() => window.fischLive.reactiveStatus())).owner).toBeNull();
    expect(metrics.reactiveOwner).toBeNull(); expect(metrics.cameraActive).toBe(false); expect(state.fetches).toBe(1); expect(state.reserves).toBe(1);
  } finally { state.release?.(); await page.close(); }
}, 30000);
