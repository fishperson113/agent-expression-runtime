import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

it('opens a keyboard-accessible Live page without camera capture and preserves reduced motion', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  let browser; const errors = [];
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'live.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.fischLive));
    await expect.poll(() => page.locator('#motion').inputValue()).toBe('reduced');
    expect(await page.locator('#camera-start').isEnabled()).toBe(true);
    expect(await page.locator('#camera-stop').isEnabled()).toBe(false);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBe(null);
    await page.keyboard.press('Tab'); expect(await page.locator('.skip').evaluate(node => node === document.activeElement)).toBe(true);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#stop-all').click();
    expect(await page.locator('#connection').textContent()).toBe('Đã dừng phiên Live');
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 45000);

it('draws a facial resting body, changes declared features on activity and freezes motion-off', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  let browser; const errors = [];
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'live.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.fischLive));
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
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 45000);

it('shows equal call panels with camera and honest activity together, accessible on mobile', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser; const errors = [];
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'live.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.fischLive));
    const body = await page.locator('.body-stage').boundingBox(), camera = await page.locator('.camera-stage').boundingBox();
    expect(Math.abs(body.width - camera.width)).toBeLessThan(2);
    expect(body.x).toBeLessThan(camera.x); expect(Math.abs(body.height-camera.height)).toBeLessThan(2);
    expect(await page.locator('.camera-panel #agent-activity').count()).toBe(1);
    expect(await page.locator('#agent-activity').getAttribute('aria-label')).toBeTruthy();
    expect(await page.locator('#enable-reactivity').isChecked()).toBe(false);
    await page.locator('.camera-options>summary').click();
    expect(await page.locator('#enable-reactivity').isVisible()).toBe(true);
    expect(await page.locator('#enable-reactivity').getAttribute('aria-describedby')).toBe('reactivity-privacy');
    expect(await page.locator('#enable-reactivity').isDisabled()).toBe(true);
    await page.evaluate(() => window.fischLive.activity({ turn: 'idle', output: 0, quality: 'codex-agent-message-delta' }));
    await page.locator('#enable-reactivity').check(); await page.locator('#enable-reactivity').uncheck();
    expect(await page.evaluate(() => window.fischLive.reactivity().events)).toEqual([]);
    const session = await page.evaluate(() => window.fischLive.reactivity().sessionId);
    await page.locator('#cancel').click();
    expect(await page.evaluate(() => window.fischLive.reactivity().sessionId)).not.toBe(session);
    await page.evaluate(() => window.fischLive.activity({ turn: 'working', output: 0, quality: 'fixture' }));
    await page.waitForTimeout(600);
    const logs = await page.locator('#agent-activity li').count();
    await page.evaluate(() => window.fischLive.activity({ turn: 'working', output: 0, quality: 'fixture' }));
    await page.waitForTimeout(600); expect(await page.locator('#agent-activity li').count()).toBe(logs);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBe(null);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('.camera-panel').boundingBox()).y).toBeGreaterThan((await page.locator('.body-panel').boundingBox()).y);
    expect(await page.locator('#cancel').isVisible()).toBe(true);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 45000);
