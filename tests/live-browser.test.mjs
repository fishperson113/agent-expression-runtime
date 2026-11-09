import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

it('opens a keyboard-accessible Live page without camera capture and preserves reduced motion', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.goto(server.resolvedUrls.local[0] + 'live.html');
    await expect.poll(() => page.locator('#motion').inputValue()).toBe('reduced');
    expect(await page.getByRole('button', { name: 'Bật camera', exact: true }).isEnabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Tắt camera', exact: true }).isEnabled()).toBe(false);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBe(null);
    await page.keyboard.press('Tab'); expect(await page.locator('.skip').evaluate(node => node === document.activeElement)).toBe(true);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Dừng toàn bộ' }).click();
    expect(await page.locator('#connection').textContent()).toBe('Đã dừng phiên Live');
  } finally { await browser?.close(); await server.close(); }
}, 45000);

it('draws a facial resting body, changes declared features on activity and freezes motion-off', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls.local[0] + 'live.html');
    await page.waitForFunction(() => window.fischLive?.metrics().scene === 'face');
    const metrics = await page.evaluate(() => window.fischLive.metrics());
    expect(metrics.parts).toContain('mouth'); expect(metrics.parts).toContain('eye_left');
    const canvas = page.locator('#body'), idle = await canvas.screenshot();
    await page.evaluate(() => window.fischLive.activity({ turn: 'working', output: 0, quality: 'fixture' }));
    await page.waitForTimeout(450);
    expect((await canvas.screenshot()).equals(idle)).toBe(false);
    await page.locator('#motion').selectOption('off');
    const frozen = await canvas.screenshot();
    await page.evaluate(() => window.fischLive.activity({ turn: 'working', output: 1, quality: 'fixture' }));
    await page.waitForTimeout(450);
    expect((await canvas.screenshot()).equals(frozen)).toBe(true);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBe(null);
  } finally { await browser?.close(); await server.close(); }
}, 45000);

it('keeps the body larger than the optional camera, with reachable controls on narrow screens', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    await page.goto(server.resolvedUrls.local[0] + 'live.html');
    const body = await page.locator('#body').boundingBox(), camera = await page.locator('.camera-stage').boundingBox();
    expect(body.width).toBeGreaterThan(camera.width * 3); expect(body.height).toBeGreaterThan(600);
    await page.locator('.camera-panel>summary').click();
    expect(await page.locator('#camera-start').isVisible()).toBe(false);
    expect(await page.locator('#cancel').isVisible()).toBe(true);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#body').boundingBox()).toMatchObject({ width: 343 });
  } finally { await browser?.close(); await server.close(); }
}, 45000);
