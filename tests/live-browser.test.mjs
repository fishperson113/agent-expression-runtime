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
