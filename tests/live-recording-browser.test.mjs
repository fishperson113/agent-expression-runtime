import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

let server, browser;
beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
afterAll(async () => { await browser?.close(); await server?.close(); });
async function fixture(frameDelay = 0) {
  const page = await browser.newPage();
  await page.clock.install({ time: new Date('2026-11-09T12:00:00Z') });
  if (frameDelay) await page.addInitScript(() => {
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => frame(at => {
      const remaining = (window.__recordingFrameUntil ?? 0) - performance.now();
      if (remaining > 0) setTimeout(() => callback(performance.now()), remaining);
      else callback(at);
    });
  });
  await page.goto(server.resolvedUrls.local[0] + 'live.html?fixture=synthetic');
  await page.waitForFunction(() => !!window.fischLive);
  await page.clock.pauseAt(new Date('2026-11-09T12:00:30Z'));
  await page.locator('.debug>summary').click();
  return page;
}
async function candidate(page) {
  await page.evaluate(() => {
    window.fischLive.configureReactive(true);
    const enabled = document.querySelector('#enable-reactivity'); enabled.checked = true; enabled.dispatchEvent(new Event('change'));
    window.fischLive.fixture('present');
  });
  await page.clock.runFor(1100); await page.evaluate(() => window.fischLive.fixture('present'));
  await page.clock.runFor(800);
  return page.evaluate(() => {
    window.fischLive.fixture('present'); const value = window.fischLive.takeReactiveRequest();
    if (!value || !window.fischLive.authorizeReactiveRequest(value.request.requestId)) throw Error('missing_recorded_request');
    return value.request;
  });
}
function expression(request) {
  return { schemaVersion: 1, requestId: request.requestId, decisionId: 'recorded_decision', mode: 'express', validUntil: request.deadline,
    action: { actionId: 'recorded_action', body: { type: 'live', program: null,
      configuration: { controls: [], poses: [{ type: 'pose', target: { part: 'body', prop: 'rotateY' }, value: 0.2, durationMs: 800 }], lifetimeMs: 1000 } } } };
}
async function recordedApplication(page, request) {
  while (true) {
    const state = await page.evaluate(id => {
      const bundle = window.fischLive.recordingSnapshot();
      const linked = bundle.records.filter(r => r.payload.origin === 'reactive' &&
        r.payload.requestId === id && r.payload.decisionId === 'recorded_decision' && r.payload.actionId === 'recorded_action');
      return { bundle, now: performance.now(), applied: linked.some(r => r.kind === 'execution' && r.payload.phase === 'applied'),
        frame: linked.some(r => r.kind === 'execution' && r.payload.phase === 'frame_submitted'),
        cancelled: linked.some(r => r.kind === 'execution' && r.payload.phase === 'cancelled'),
        metrics: window.fischLive.metrics(), reactive: window.fischLive.reactiveStatus() };
    }, request.requestId);
    if (state.applied && state.frame) return state;
    if (state.cancelled || state.now + 16 >= request.deadline || state.bundle.manifest.incomplete)
      throw Error('recorded_application_missing:' + JSON.stringify(state));
    await page.clock.runFor(16);
  }
}
async function downloadBundle(page) {
  const event = page.waitForEvent('download'); await page.locator('#trace-export').click();
  const download = await event, chunks = [], stream = await download.createReadStream();
  for await (const chunk of stream) chunks.push(chunk);
  return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') };
}
it.each([0, 240])('records linked observer/render evidence after application with %ims frame delay', async frameDelay => {
  const page = await fixture(frameDelay);
  try {
    expect(await page.evaluate(() => window.fischLive.recordingSnapshot())).toEqual({ schemaVersion: 1, manifest: null, records: [] });
    await page.evaluate(() => window.fischLive.logActivity('PRIVATE_ACTIVITY_CANARY'));
    await page.locator('#trace-start').click(); const request = await candidate(page);
    if (frameDelay) await page.evaluate(delay => { window.__recordingFrameUntil = performance.now() + delay; }, frameDelay);
    expect((await page.evaluate(({ id, data }) => window.fischLive.deliverReactiveDecision(id, data),
      { id: request.requestId, data: expression(request) })).reason).toBe('accepted');
    if (frameDelay) {
      await page.clock.runFor(160);
      expect((await page.evaluate(() => window.fischLive.recordingSnapshot())).records.some(r =>
        r.kind === 'execution' && r.payload.origin === 'reactive' && r.payload.phase === 'applied')).toBe(false);
    }
    const applied = await recordedApplication(page, request);
    expect(applied.now).toBeLessThan(request.deadline);
    expect(applied.bundle.manifest.droppedRecords).toBe(0);
    await page.locator('#trace-stop').click();
    const downloaded = await downloadBundle(page), bundle = JSON.parse(downloaded.text);
    expect(downloaded.name).toMatch(/^fisch-causal-[a-z0-9-]+\.json$/);
    expect(bundle.manifest.mode).toBe('synthetic'); expect(bundle.manifest.active).toBe(false);
    for (const kind of ['observation', 'event', 'request', 'authorization', 'decision', 'execution', 'frame'])
      expect(bundle.records.some(record => record.kind === kind)).toBe(true);
    const observations = bundle.records.filter(record => record.kind === 'observation');
    expect(observations.every(record => !Object.hasOwn(record.payload, 'summary'))).toBe(true);
    const observed = new Set(observations.map(record => `${record.payload.sessionId}:${record.payload.seq}`));
    const recorded = bundle.records.find(record => record.kind === 'request');
    expect(recorded.payload.observationRefs.every(ref => observed.has(`${ref.sessionId}:${ref.seq}`))).toBe(true);
    expect(bundle.records.some(record => record.kind === 'execution' && record.payload.origin === 'reactive' && record.payload.phase === 'applied')).toBe(true);
    expect(downloaded.text).not.toContain('PRIVATE_ACTIVITY_CANARY');
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull();
  } finally { await page.close(); }
}, 45000);
it('does not replace an expired action with a later applied receipt', async () => {
  const page = await fixture(6000);
  try {
    await page.locator('#trace-start').click(); const request = await candidate(page);
    await page.evaluate(() => { window.__recordingFrameUntil = performance.now() + 6000; });
    expect((await page.evaluate(({ id, data }) => window.fischLive.deliverReactiveDecision(id, data),
      { id: request.requestId, data: expression(request) })).reason).toBe('accepted');
    await expect(recordedApplication(page, request)).rejects.toThrow('recorded_application_missing:');
    await page.clock.runFor(1200);
    const bundle = await page.evaluate(() => window.fischLive.recordingSnapshot());
    const linked = bundle.records.filter(r => r.payload.requestId === request.requestId && r.payload.actionId === 'recorded_action');
    expect(linked.some(r => r.kind === 'execution' && r.payload.phase === 'applied')).toBe(false);
    expect(linked.some(r => r.kind === 'execution' && r.payload.phase === 'cancelled')).toBe(true);
  } finally { await page.close(); }
}, 45000);
it('retains only safe outcome metadata for revoked and invalid decisions', async () => {
  for (const mode of ['revoked', 'invalid']) {
    const page = await fixture();
    try {
      await page.locator('#trace-start').click(); const request = await candidate(page);
      if (mode === 'revoked') await page.evaluate(() => window.fischLive.reactiveUserIntent());
      const value = mode === 'invalid' ? { arbitrary: 'PRIVATE_PROVIDER_CANARY' } : expression(request);
      const result = await page.evaluate(({ id, value }) => window.fischLive.deliverReactiveDecision(id, value), { id: request.requestId, value });
      expect(result.reason).toBe(mode === 'revoked' ? 'revoked' : 'invalid_decision');
      const bundle = await page.evaluate(() => window.fischLive.recordingSnapshot());
      expect(bundle.records.some(record => record.kind === 'decision' && record.payload.reason === result.reason)).toBe(true);
      expect(bundle.records.some(record => record.kind === 'execution' && record.payload.origin === 'reactive' && record.payload.phase === 'applied')).toBe(false);
      expect(JSON.stringify(bundle)).not.toContain('PRIVATE_PROVIDER_CANARY');
    } finally { await page.close(); }
  }
}, 60000);
it('stops capture explicitly, expires retained data and clears on full stop', async () => {
  const page = await fixture();
  try {
    await page.locator('#trace-start').click(); await page.evaluate(() => window.fischLive.fixture('present'));
    await page.locator('#trace-stop').click(); const stopped = await page.evaluate(() => window.fischLive.recordingSnapshot());
    await page.evaluate(() => window.fischLive.fixture('absent'));
    expect((await page.evaluate(() => window.fischLive.recordingSnapshot())).records).toEqual(stopped.records);
    await page.clock.fastForward(60001);
    expect((await page.evaluate(() => window.fischLive.recordingSnapshot())).records).toEqual([]);
    expect(await page.locator('#trace-export').isDisabled()).toBe(true);
    await page.locator('#trace-start').click(); await page.evaluate(() => window.fischLive.fixture('present'));
    await page.locator('#stop-all').click();
    expect(await page.evaluate(() => window.fischLive.recordingSnapshot())).toEqual({ schemaVersion: 1, manifest: null, records: [] });
    expect(await page.evaluate(() => window.fischLive.startRecording())).toBe(false);
  } finally { await page.close(); }
}, 45000);
it('stops with camera shutdown and clears when the visibility handler suspends the source', async () => {
  const page = await fixture();
  try {
    await page.locator('#trace-start').click(); await page.evaluate(() => window.fischLive.fixture('present'));
    await page.evaluate(() => document.querySelector('#camera-stop').onclick());
    const stopped = await page.evaluate(() => window.fischLive.recordingSnapshot());
    expect(stopped.manifest.active).toBe(false); expect(stopped.records.length).toBeGreaterThan(0);
    await page.evaluate(() => window.fischLive.fixture('absent'));
    expect((await page.evaluate(() => window.fischLive.recordingSnapshot())).records).toEqual(stopped.records);
    await page.locator('#trace-start').click(); await page.evaluate(() => window.fischLive.fixture('present'));
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await page.evaluate(() => window.fischLive.recordingSnapshot())).toEqual({ schemaVersion: 1, manifest: null, records: [] });
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull();
  } finally { await page.close(); }
}, 30000);
