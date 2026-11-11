import { beforeAll, afterAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { presentDesktopHost } from '../integrations/desktop-live-host.mjs';
import { join } from 'node:path';
let server, browser;
beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}, 45000);
afterAll(async () => { await browser?.close(); await server?.close(); });
async function open() {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(server.resolvedUrls.local[0] + 'live.html?fixture=synthetic');
  await page.waitForFunction(() => window.fischLive?.metrics().scene === 'face');
  await page.waitForFunction(() => typeof window.fischLive?.setupStatus === 'function');
  await page.evaluate(() => { window.setupUnderTest = { project: value => window.fischLive.setupStatus(value) }; });
  return { page, panel: page.locator('.fisch-live-setup') };
}
it('separates gateway, selected Native session and configured observer without enabling media', async () => {
  const { page, panel } = await open();
  try {
    expect(await panel.textContent()).toContain('Chưa xác nhận');
    await page.evaluate(() => window.setupUnderTest.project({ native: 'waiting', observer: 'unavailable' }));
    expect(await panel.textContent()).toContain('chờ chọn phiên');
    expect(await panel.locator('details').getAttribute('open')).toBeNull();
    expect(await panel.locator('.setup-state').isVisible()).toBe(true);
    await page.evaluate(() => window.setupUnderTest.project({ native: 'connected', observer: 'ready' }));
    expect(await panel.textContent()).toContain('chưa xác nhận lượt trả lời');
    expect(await panel.textContent()).toContain('đã cấu hình');
    expect(await panel.locator('input,textarea').count()).toBe(0);
    const summary = panel.locator('summary'); await summary.focus(); await page.keyboard.press('Enter');
    expect(await panel.locator('details').getAttribute('open')).not.toBeNull();
    expect(await panel.locator('ol > li').count()).toBe(3);
    const guide = panel.getByRole('link', { name: 'Hướng dẫn cấu hình observer' });
    expect(await guide.getAttribute('href')).toBe('https://github.com/fishperson113/agent-expression-runtime/blob/main/docs/reactive-provider.md');
    expect(await guide.getAttribute('rel')).toBe('noopener noreferrer');
    expect(await panel.textContent()).toContain('không tự gửi');
    expect(await panel.textContent()).toContain('Codex chủ động được chuẩn bị mặc định');
    expect(await panel.textContent()).toContain('không cần tự đặt biến môi trường hay tạo ledger');
    expect(await panel.textContent()).toContain('Thiết lập ở Góc của bạn');
    expect(await page.locator('video').evaluate(node => node.srcObject)).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport); await page.evaluate(() => scrollTo(0, 0));
      const stop = await page.locator('#stop-all').boundingBox();
      expect(stop.y).toBeGreaterThanOrEqual(0); expect(stop.y + stop.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(() => {
        const button = document.querySelector('#stop-all'), rect = button.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button;
      })).toBe(true);
      await page.locator('#stop-all').focus(); expect(await page.locator('#stop-all').evaluate(node => node === document.activeElement)).toBe(true);
    }
  } finally { await page.close(); }
}, 45000);
it('rejects hostile data without getters or private content and avoids repeated announcements', async () => {
  const { page, panel } = await open();
  try {
    await page.evaluate(() => {
      window.setupUnderTest.project({ native: 'waiting', observer: 'missing_budget' });
      window.setupMutations = 0;
      new MutationObserver(items => { window.setupMutations += items.length; }).observe(document.querySelector('.fisch-live-setup [role=status]'), { subtree: true, childList: true, characterData: true });
      for (let i = 0; i < 50; i++) window.setupUnderTest.project({ native: 'waiting', observer: 'missing_budget' });
    });
    expect(await page.evaluate(() => window.setupMutations)).toBe(0);
    await page.evaluate(() => {
      window.getterCalls = 0; window.setupSideEffects = 0;
      window.fetch = () => { window.setupSideEffects++; throw Error('no network'); };
      for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { window.setupSideEffects++; throw Error('no storage'); };
      navigator.mediaDevices.getUserMedia = () => { window.setupSideEffects++; throw Error('no media'); };
      const values = [null, [], { native: 'connected', observer: '<img src=x onerror=alert(1)>' },
        { native: 'connected', observer: 'ready', secret: 'PRIVATE_ENDPOINT' },
        { get native() { window.getterCalls++; return 'connected'; }, observer: 'ready' },
        new Proxy({}, { ownKeys() { throw Error('PRIVATE_ENDPOINT'); } })];
      for (const value of values) window.setupUnderTest.project(value);
    });
    expect(await page.evaluate(() => window.getterCalls)).toBe(0);
    expect(await page.evaluate(() => window.setupSideEffects)).toBe(0);
    expect(await panel.textContent()).toContain('Chưa xác nhận');
    expect(await panel.textContent()).not.toContain('PRIVATE_ENDPOINT'); expect(await panel.locator('img').count()).toBe(0);
    await page.getByRole('button', { name: 'Dừng toàn bộ', exact: true }).click();
    expect(await panel.count()).toBe(0);
  } finally { await page.close(); }
}, 45000);
it('keeps external MCP setup honest through late status paints on mobile and desktop', async () => {
  const { page, panel } = await open();
  try {
    expect(await panel.locator('.setup-state').textContent()).toBe('Chờ Codex');
    await page.evaluate(() => {
      window.externalMediaRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => { window.externalMediaRequests++; throw Error('no real media'); };
    });
    await page.evaluate(presentDesktopHost);
    await panel.locator('summary').click();
    const expected = await panel.innerText();
    expect(expected).toContain('MCP bên ngoài'); expect(expected).toContain('Fisch không biết phiên Native');
    expect(expected).not.toContain('Chờ Codex'); expect(expected).not.toContain('Chạy fisch live');
    expect(await panel.getByRole('link', { name: 'Hướng dẫn cấu hình observer' }).isVisible()).toBe(false);
    expect(await panel.locator('.setup-local-guide').isVisible()).toBe(false);
    expect(await panel.locator('.setup-external-guide').isVisible()).toBe(true);
    await page.evaluate(() => {
      for (let i = 0; i < 20; i++) {
        window.fischLive.setupStatus({ native: i % 2 ? 'waiting' : 'connected', observer: i % 2 ? 'missing_budget' : 'ready' });
        window.fischLive.configureReactive(i % 2 === 0, 0, 1, true);
      }
    });
    expect(await panel.innerText()).toBe(expected);
    expect(await page.locator('.fisch-conversation form').isVisible()).toBe(false);
    expect(await page.locator('.fisch-conversation textarea').isDisabled()).toBe(true);
    expect(await page.locator('.fisch-conversation button').nth(0).isDisabled()).toBe(true);
    for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      expect(await panel.locator('.setup-state').isVisible()).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const stop = await page.locator('#stop-all').boundingBox();
      expect(stop.y).toBeGreaterThanOrEqual(0); expect(stop.y + stop.height).toBeLessThanOrEqual(viewport.height);
      if (process.env.FISCH_TEST_ARTIFACT_DIR) await page.screenshot({ path: join(process.env.FISCH_TEST_ARTIFACT_DIR, `desktop-external-setup-${viewport.width}.png`) });
    }
    expect(await page.evaluate(() => window.externalMediaRequests)).toBe(0);
    expect(await page.locator('video').evaluate(node => node.srcObject)).toBeNull();
  } finally { await page.close(); }
}, 45000);
