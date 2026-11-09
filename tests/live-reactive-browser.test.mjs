import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
let server, browser;
beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
afterAll(async () => { await browser?.close(); await server?.close(); });
async function pageFixture() {
  const page = await browser.newPage();
  await page.clock.install({ time: new Date('2026-11-09T12:00:00Z') });
  await page.goto(server.resolvedUrls.local[0] + 'live.html?fixture=synthetic');
  await page.waitForFunction(() => !!window.fischLive);
  await page.clock.pauseAt(new Date('2026-11-09T12:00:30Z'));
  await page.evaluate(() => { window.fischLive.configureReactive(true); const checkbox = document.querySelector('#enable-reactivity'); checkbox.checked = true; checkbox.dispatchEvent(new Event('change')); });
  return page;
}
async function request(page, mode = 'present') {
  await page.evaluate(mode => window.fischLive.fixture(mode), mode); await page.clock.runFor(1100);
  await page.evaluate(mode => window.fischLive.fixture(mode), mode); await page.clock.runFor(800);
  return page.evaluate(mode => { window.fischLive.fixture(mode); const value = window.fischLive.takeReactiveRequest();
    if (!value || !window.fischLive.authorizeReactiveRequest(value.request.requestId)) throw Error('missing_authorized_request:' + JSON.stringify({ status: window.fischLive.reactiveStatus(), metrics: window.fischLive.metrics() })); return value.request; }, mode);
}
function express(request, until = request.deadline) {
  return { schemaVersion: 1, requestId: request.requestId, decisionId: 'test_decision', mode: 'express', validUntil: until,
    action: { actionId: 'test_action', body: { type: 'live', program: { type: 'wait', durationMs: 100 }, configuration: { controls: [], poses: [], lifetimeMs: 1000 } } } };
}
async function deliver(page, request, value = express(request)) { return page.evaluate(({ request, value }) => window.fischLive.deliverReactiveDecision(request.requestId, value), { request, value }); }
it('keeps availability independent of activity and blocks late decisions after departure', async () => {
  const page = await pageFixture();
  try {
    await page.evaluate(() => window.fischLive.activity({ turn: 'idle', output: 0, quality: 'unavailable' }));
    expect(await page.locator('#enable-reactivity').isEnabled()).toBe(true);
    const req = await request(page); await page.evaluate(() => window.fischLive.fixture('absent'));
    expect((await deliver(page, req)).reason).toBe('revoked');
    const state = await page.evaluate(() => ({ reactive: window.fischLive.reactiveStatus(), body: window.fischLive.metrics() }));
    expect(state.reactive.owner).toBeNull(); expect(state.body.reactiveOwner).toBeNull(); expect(state.body.queueDepth).toBe(0);
    expect(state.body.cameraActive).toBe(false);
  } finally { await page.close(); }
}, 30000);
it('accepts compatible current hand frames and releases the owner at expiry', async () => {
  const page = await pageFixture();
  try {
    const req = await request(page, 'present-hand'); expect(req.requiredTrackIds).toHaveLength(1);
    await page.clock.runFor(20); await page.evaluate(() => window.fischLive.fixture('present-hand', 0.26));
    const until = await page.evaluate(() => performance.now() + 100);
    expect((await deliver(page, req, express(req, until))).reason).toBe('accepted');
    expect((await page.evaluate(() => window.fischLive.metrics())).reactiveOwner).toBe('test_action');
    await page.clock.runFor(120);
    expect((await page.evaluate(() => window.fischLive.metrics())).reactiveOwner).toBeNull();
    expect((await page.evaluate(() => window.fischLive.reactiveStatus())).owner).toBeNull();
  } finally { await page.close(); }
}, 30000);
it('revokes before delivery on camera unavailability, cancel, selected thread, user intent and stop', async () => {
  for (const mutation of ['camera', 'cancel', 'thread', 'user', 'stop']) {
    const page = await pageFixture();
    try {
      const req = await request(page);
      await page.evaluate(mutation => {
        const api = window.fischLive;
        if (mutation === 'camera') api.fixture('denied');
        if (mutation === 'thread') void api.selectThread();
        if (mutation === 'user') api.reactiveUserIntent();
        if (mutation === 'cancel') document.querySelector('#cancel').click();
        if (mutation === 'stop') document.querySelector('#stop-all').click();
      }, mutation);
      expect((await deliver(page, req)).reason).toBe('revoked');
      expect((await page.evaluate(() => window.fischLive.metrics())).reactiveOwner).toBeNull();
    } finally { await page.close(); }
  }
}, 60000);
