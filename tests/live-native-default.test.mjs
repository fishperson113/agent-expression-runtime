import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
let server, browser;
beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}, 45000);
afterAll(async () => { await browser?.close(); await server?.close(); });
async function open(synthetic = false) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.mediaCalls = [];
    navigator.mediaDevices.getUserMedia = async constraints => { window.mediaCalls.push(constraints); throw new DOMException('fixture denial', 'NotAllowedError'); };
  });
  await page.goto(server.resolvedUrls.local[0] + 'live.html' + (synthetic ? '?fixture=synthetic' : ''));
  await page.waitForFunction(() => Boolean(window.fischLive)); return page;
}
const native = () => window.fischLive.configureReactive(true, 1, 1, true);
it('arms Native by default without camera or a model request, and asks for video only on user action', async () => {
  const page = await open();
  try {
    await page.evaluate(native);
    expect(await page.locator('#enable-reactivity').isChecked()).toBe(true);
    expect(await page.evaluate(() => window.mediaCalls)).toEqual([]);
    expect(await page.evaluate(() => window.fischLive.takeReactiveRequest())).toBeNull();
    expect((await page.locator('#reactivity-status').textContent())).toContain('Chưa xác nhận');
    await page.locator('#camera-start').click();
    await expect.poll(() => page.evaluate(() => window.mediaCalls.length)).toBe(1);
    expect(await page.evaluate(() => window.mediaCalls[0].audio)).toBe(false);
    expect(await page.evaluate(() => window.fischLive.takeReactiveRequest())).toBeNull();
    expect(await page.locator('video').evaluate(node => node.srcObject)).toBeNull();
  } finally { await page.close(); }
}, 45000);
it('does not rearm an explicit opt-out on polling, reconnect or Stop', async () => {
  const page = await open();
  try {
    await page.evaluate(native); await page.locator('.camera-options > summary').click();
    await page.locator('#enable-reactivity').uncheck();
    await page.evaluate(() => { for (let i = 0; i < 20; i++) window.fischLive.configureReactive(true, 1, 1, true); window.fischLive.configureReactive(false, 1, 1, true); window.fischLive.configureReactive(true, 1, 1, true); });
    expect(await page.locator('#enable-reactivity').isChecked()).toBe(false);
    expect(await page.evaluate(() => window.fischLive.takeReactiveRequest())).toBeNull();
    await page.locator('#stop-all').click(); await page.evaluate(native);
    expect(await page.locator('#enable-reactivity').isDisabled()).toBe(true);
    expect(await page.locator('#enable-reactivity').isChecked()).toBe(false);
    expect(await page.evaluate(() => window.mediaCalls)).toEqual([]);
  } finally { await page.close(); }
}, 45000);
it('automatically admits a synthetic observation opportunity without resetting it on every configure poll', async () => {
  const page = await open(true);
  try {
    await page.evaluate(() => {
      window.fischLive.configureReactive(true, 1, 1, true);
      window.source = setInterval(() => { window.fischLive.fixture('present-neutral'); window.fischLive.configureReactive(true, 1, 1, true); }, 150);
    });
    let request;
    await expect.poll(async () => request ??= await page.evaluate(() => window.fischLive.takeReactiveRequest()), { timeout: 10000 }).toBeTruthy();
    expect(request.observationWindow.events.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.mediaCalls)).toEqual([]);
    expect(await page.locator('video').evaluate(node => node.srcObject)).toBeNull();
  } finally { await page.evaluate(() => clearInterval(window.source)); await page.close(); }
}, 45000);
it('keeps non-Native configured providers opt-in', async () => {
  const page = await open();
  try { await page.evaluate(() => window.fischLive.configureReactive(true)); expect(await page.locator('#enable-reactivity').isChecked()).toBe(false); }
  finally { await page.close(); }
}, 45000);
it('keeps a runtime-unavailable Native status visible despite later configured snapshots', async () => {
  const page = await open();
  try {
    await page.evaluate(() => { window.fischLive.setupStatus({ native: 'connected', observer: 'ready' }); window.fischLive.configureReactive(false, 1, 1, true); window.fischLive.setupStatus({ native: 'connected', observer: 'ready' }); });
    expect(await page.locator('.setup-state').textContent()).toBe('Đang tạm dừng');
    expect(await page.locator('.setup-state').isVisible()).toBe(true);
    expect(await page.evaluate(() => window.mediaCalls)).toEqual([]);
    await page.evaluate(native); expect(await page.locator('.setup-state').textContent()).toBe('Đã cấu hình');
  } finally { await page.close(); }
}, 45000);
