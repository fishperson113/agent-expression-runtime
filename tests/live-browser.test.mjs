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
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
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

it('shows a large Fisch panel beside a narrower camera and activity panel with camera and honest activity together, accessible on mobile', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser; const errors = [];
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'live.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.fischLive));
    const body = await page.locator('.body-stage').boundingBox(), camera = await page.locator('.camera-stage').boundingBox();
    const left = await page.locator('.body-panel').boundingBox(), right = await page.locator('.camera-panel').boundingBox();
    expect(left.width / right.width).toBeCloseTo(2, 1);
    expect(body.x).toBeLessThan(camera.x); expect(body.height).toBeGreaterThan(camera.height * 1.5);
    expect(await page.locator('.camera-panel #agent-activity').count()).toBe(1);
    expect(await page.locator('#agent-activity').getAttribute('aria-label')).toBeTruthy();
    expect(await page.locator('#enable-reactivity').isChecked()).toBe(false);
    await page.locator('.camera-options>summary').click();
    expect(await page.locator('#enable-reactivity').isVisible()).toBe(true);
    expect(await page.locator('#enable-reactivity').getAttribute('aria-describedby')).toBe('reactivity-privacy');
    expect(await page.locator('#enable-reactivity').isDisabled()).toBe(true);
    await page.evaluate(() => window.fischLive.activity({ turn: 'idle', output: 0, quality: 'codex-agent-message-delta' }));
    expect(await page.locator('#enable-reactivity').isDisabled()).toBe(true);
    await page.evaluate(() => window.fischLive.configureReactive(true));
    await page.locator('#enable-reactivity').check();
    expect(await page.evaluate(() => window.fischLive.reactivity())).toMatchObject({ enabled: false, stopped: true, camera: 'stopped', events: [] });
    await page.locator('#enable-reactivity').uncheck();
    await page.keyboard.press('Escape');
    await page.locator('#cancel').click();
    expect(await page.evaluate(() => window.fischLive.reactiveStatus())).toMatchObject({ pending: 0, owner: null, sourceValid: false });
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

it('fills wide windows without an unused strip and keeps the 2:1 panels', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'live.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.fischLive));
    for (const width of [1833, 2560]) {
      await page.setViewportSize({ width, height: 1080 });
      const left = await page.locator('.body-panel').boundingBox(), right = await page.locator('.camera-panel').boundingBox();
      expect(left.x).toBe(24); expect(Math.abs(width - right.x - right.width - 24)).toBeLessThan(1);
      expect(left.width / right.width).toBeCloseTo(2, 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBe(null);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 45000);

async function inViewport(page, selector) {
  const result = await page.locator(selector).evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.x >= 0 && box.y >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
  });
  expect(result, selector).toBe(true);
}

it('keeps the workspace within one screen, scrolls only history, and redraws a frozen face on resize', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls.local[0] + 'live.html');
    await page.waitForFunction(() => window.fischLive?.metrics().render.frame > 3);
    await page.locator('#motion').selectOption('off');
    for (const [width, height] of [[1440, 900], [1280, 720], [390, 844], [320, 568], [844, 390], [640, 450]]) {
      const before = await page.evaluate(() => window.fischLive.metrics().render);
      await page.setViewportSize({ width, height });
      await expect.poll(() => page.evaluate(() => window.fischLive.metrics().render.frame)).toBeGreaterThan(before.frame);
      expect((await page.evaluate(() => window.fischLive.metrics().render)).signature).toBe(before.signature);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const selector of ['.body-panel', '.camera-card', '.activity-panel', '#motion', '#cancel', '#camera-start', '#stop-all']) await inViewport(page, selector);
      expect(await page.evaluate(() => [...document.querySelectorAll('.body-panel,.camera-card,.activity-panel')].every(node => node.scrollHeight <= node.clientHeight + 1))).toBe(true);
      const left = await page.locator('.body-panel').boundingBox(), right = await page.locator('.camera-panel').boundingBox();
      expect(width > 700 ? left.width / right.width : left.height / right.height).toBeCloseTo(2, 1);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#fullscreen').click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe('body-panel');
    await inViewport(page, '#stop-all'); await inViewport(page, '#cancel');
    await page.locator('.fisch-playground summary').click();
    expect(await page.locator('dialog[open] #stop-all').count()).toBe(1);
    await page.keyboard.press('Escape');
    expect(await page.locator('.body-panel > .body-toolbar #stop-all').count()).toBe(1);
    await page.locator('#cancel').click();
    await page.getByRole('button', { name: 'Thoát toàn màn hình', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect.poll(() => page.locator('footer #stop-all').count()).toBe(1);
    await page.evaluate(() => { for (let i = 0; i < 40; i++) window.fischLive.logActivity('Sự kiện kiểm thử dài '.repeat(8)); });
    expect(await page.locator('#agent-activity').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    await page.locator('#fullscreen').click(); await page.locator('#stop-all').click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    expect(await page.locator('#connection').textContent()).toBe('Đã dừng phiên Live');
  } finally { await browser?.close(); await server.close(); }
}, 45000);

it('dismisses tools with keyboard and backdrop, preserves drafts, and leaves emergency stop reachable', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 320, height: 568 } }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'live.html'); await page.waitForFunction(() => Boolean(window.fischLive));
    for (const selector of ['.camera-options', '.debug', '.fisch-playground details', '.fisch-live-setup details']) {
      const details = page.locator(selector), summary = details.locator('summary');
      for (let repeat = 0; repeat < 2; repeat++) {
        await summary.focus(); await page.keyboard.press('Enter');
        await expect.poll(() => details.locator('dialog').getAttribute('open')).not.toBeNull();
        await inViewport(page, 'dialog[open]'); await inViewport(page, '#stop-all');
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
        if (selector.includes('playground')) await details.getByLabel('Ý tưởng').fill('Giữ ý tưởng của tôi');
        if (repeat === 0) await page.keyboard.press('Escape'); else await page.mouse.click(1, 1);
        await expect.poll(() => page.locator('dialog[open]').count()).toBe(0);
        expect(await summary.evaluate(node => node === document.activeElement)).toBe(true);
      }
    }
    await page.locator('.fisch-playground summary').click();
    expect(await page.getByLabel('Ý tưởng').inputValue()).toBe('Giữ ý tưởng của tôi');
    await page.locator('#stop-all').click();
    expect(await page.locator('#connection').textContent()).toBe('Đã dừng phiên Live');
    expect(await page.locator('dialog[open]').count()).toBe(0);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull(); expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.close(); }
}, 45000);

it.each(['resolve', 'reject'])('ignores delayed clipboard %s after dismissal without reopening or stealing another tool', async outcome => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls.local[0] + 'live.html'); await page.waitForFunction(() => Boolean(window.fischLive));
    await page.evaluate(outcome => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => new Promise((resolve, reject) => { window.finishClipboard = () => outcome === 'resolve' ? resolve() : reject(Error('denied')); })
    } }), outcome);
    const panel = page.locator('.fisch-playground'); await panel.locator('summary').click();
    await panel.getByLabel('Ý tưởng', { exact: true }).fill('Giữ bản nháp');
    await panel.getByRole('button', { name: 'Nguyên tác', exact: true }).click();
    await page.keyboard.press('Escape'); await page.locator('.camera-options summary').click();
    await page.evaluate(async () => { window.finishClipboard(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(await page.locator('dialog[open]').count()).toBe(1);
    expect(await page.locator('.camera-options dialog[open] #stop-all').count()).toBe(1);
    expect(await page.locator('.camera-options dialog').evaluate(node => node.contains(document.activeElement))).toBe(true);
    expect(await panel.locator('details').getAttribute('open')).toBeNull();
    await page.keyboard.press('Escape'); await panel.locator('summary').click();
    expect(await panel.getByLabel('Ý tưởng', { exact: true }).inputValue()).toBe('Giữ bản nháp');
    await panel.getByRole('button', { name: 'Nguyên tác', exact: true }).click();
    await page.keyboard.press('Escape'); await panel.locator('summary').click();
    await panel.getByLabel('Ý tưởng', { exact: true }).fill('Bản nháp mới');
    await page.evaluate(async () => { window.finishClipboard(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(await panel.locator('dialog[open]').count()).toBe(1);
    expect(await panel.getByLabel('Ý tưởng', { exact: true }).inputValue()).toBe('Bản nháp mới');
    expect(await panel.locator('.pg-output').isVisible()).toBe(false);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull();
  } finally { await browser?.close(); await server.close(); }
}, 45000);
