import { beforeAll, afterAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

let server, browser;
beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}, 45000);
afterAll(async () => { await browser?.close(); await server?.close(); });

async function open(fallback = false) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 }, reducedMotion: 'reduce' });
  await page.goto(server.resolvedUrls.local[0] + 'live.html?fixture=synthetic');
  await page.waitForFunction(() => window.fischLive?.metrics().scene === 'face');
  await page.evaluate(fallback => {
    window.copiedRequests = []; window.persistence = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => {
      window.copiedRequests.push(value); if (fallback) throw Error('clipboard unavailable');
    } } });
    for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { window.persistence++; throw Error('no storage'); };
    window.playgroundUnderTest = { project: value => window.fischLive.playgroundStatus(value), clear: () => window.fischLive.playgroundClear() };
  }, fallback);
  return { page, panel: page.locator('.fisch-playground') };
}

it('explicit copy stays camera-off and changes neither the body nor storage', async () => {
  const { page, panel } = await open();
  try {
    expect(await panel.textContent()).toContain('client đã kết nối Fisch MCP');
    expect(await panel.textContent()).toContain('playground_state/playground_edit');
    expect(await panel.textContent()).toContain('Chat Native và biểu đạt tự động là luồng riêng');
    expect(await panel.textContent()).not.toContain('Dán vào terminal Codex đang chạy cùng Fisch');
    const mutations = []; page.on('request', request => { if (request.method() !== 'GET' || new URL(request.url()).pathname.startsWith('/v1/')) mutations.push(request.method()); });
    const controls = await page.locator('#cancel').boundingBox();
    expect(controls.y + controls.height).toBeLessThanOrEqual(950);
    expect((await page.locator('.body-stage').boundingBox()).height).toBeGreaterThanOrEqual(440);
    await page.locator('#motion').selectOption('off'); const body = await page.locator('#body').screenshot();
    const summary = panel.locator('summary'); await summary.focus(); await page.keyboard.press('Enter');
    await panel.getByLabel('Ý tưởng').fill('Một chiếc lá phát sáng'); await panel.getByLabel('Mục tiêu tùy chọn').fill('Tôi muốn thử hai cách chuyển động');
    expect(await page.evaluate(() => window.copiedRequests.length)).toBe(0);
    await panel.getByRole('button', { name: 'Nguyên tác', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.copiedRequests.length)).toBe(1);
    const request = await page.evaluate(() => window.copiedRequests[0]);
    expect(request).toContain('Một chiếc lá phát sáng'); expect(request).toContain('playground_edit'); expect(request).toContain('create');
    expect(request).not.toContain('"type":"assemble"'); expect(await panel.locator('details').getAttribute('open')).toBeNull();
    await expect.poll(() => panel.locator('dialog[open]').count()).toBe(0);
    await expect.poll(() => summary.evaluate(node => node === document.activeElement)).toBe(true);
    expect(await page.locator('#body').screenshot()).toEqual(body);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull(); expect(await page.evaluate(() => window.persistence)).toBe(0);
    expect(mutations).toEqual([]);
    await summary.click(); expect(await panel.textContent()).toContain('chưa gửi');
    await page.evaluate(() => window.playgroundUnderTest.clear());
    expect(await panel.getByLabel('Ý tưởng').inputValue()).toBe(''); expect(await panel.getByLabel('Mục tiêu tùy chọn').inputValue()).toBe('');
  } finally { await page.close(); }
}, 45000);

it('validates full drafts without truncation and exposes a selectable fallback for explicit recovery', async () => {
  const { page, panel } = await open(true);
  try {
    await panel.locator('summary').click();
    await panel.getByLabel('Ý tưởng').fill('x'.repeat(501)); await panel.getByRole('button', { name: 'Nguyên tác', exact: true }).click();
    expect((await panel.getByLabel('Ý tưởng').inputValue()).length).toBe(501); expect(await panel.locator('.pg-error').textContent()).toContain('500');
    await panel.getByLabel('Ý tưởng').fill('hai\ndòng'); await panel.getByRole('button', { name: 'Nguyên tác', exact: true }).click();
    expect(await page.evaluate(() => window.copiedRequests.length)).toBe(0);
    await panel.getByLabel('Ý tưởng').fill('Ý tưởng tổng hợp'); await panel.getByLabel('Mục tiêu tùy chọn').fill('x'.repeat(161));
    await panel.getByRole('button', { name: 'Chỉnh ý tưởng', exact: true }).click(); expect(await panel.locator('.pg-error').textContent()).toContain('160');
    await panel.getByRole('button', { name: 'Phục hồi', exact: true }).click();
    const output = panel.getByLabel('Yêu cầu chưa gửi tới Codex'); await expect.poll(() => output.isVisible()).toBe(true);
    expect(await output.inputValue()).toContain('xóa lịch sử'); expect(await output.getAttribute('readonly')).not.toBeNull();
    expect(await output.evaluate(node => node.selectionStart === 0 && node.selectionEnd === node.value.length)).toBe(true);
    expect(await panel.locator('details').getAttribute('open')).not.toBeNull();
    await page.evaluate(() => window.playgroundUnderTest.clear()); expect(await output.inputValue()).toBe('');
  } finally { await page.close(); }
}, 45000);

it('projects only redacted counters, resists HTML, avoids repeated announcements and fits mobile', async () => {
  const { page, panel } = await open();
  try {
    expect(await panel.locator('.pg-status').textContent()).toContain('Chưa xác nhận');
    await page.evaluate(() => window.playgroundUnderTest.project({ status: 'stored', revision: 4, scenes: 3, operation: 'remix' }));
    expect(await panel.locator('.pg-status').textContent()).toContain('3 bản đã lưu');
    await page.evaluate(() => {
      window.statusMutations = 0; new MutationObserver(list => { window.statusMutations += list.length; }).observe(document.querySelector('.fisch-playground .pg-status'), { childList: true, characterData: true, subtree: true });
      for (let i = 0; i < 100; i++) window.playgroundUnderTest.project({ status: 'stored', revision: 4, scenes: 3, operation: 'remix' });
    }); expect(await page.evaluate(() => window.statusMutations)).toBe(0);
    await page.evaluate(() => window.playgroundUnderTest.project({ status: 'uncertain', revision: 4, scenes: 3, recoveryRequired: true }));
    expect(await panel.locator('.pg-status').textContent()).toContain('3 bản đã lưu'); expect(await panel.locator('.pg-status').textContent()).toContain('phục hồi');
    await page.evaluate(() => window.playgroundUnderTest.project({ status: '<img src=x onerror="window.evil=1">', scenes: -1 }));
    expect(await panel.locator('img').count()).toBe(0); expect(await page.evaluate(() => window.evil)).toBeUndefined();
    await panel.locator('summary').click(); await panel.getByLabel('Ý tưởng').fill('<img src=x onerror=alert(1)>');
    await panel.getByRole('button', { name: 'Nguyên tác', exact: true }).click(); expect(await panel.locator('img').count()).toBe(0);
    await page.setViewportSize({ width: 375, height: 812 }); await panel.locator('summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('.body-stage').boundingBox()).height).toBeGreaterThanOrEqual(812 * .1);
    await page.getByRole('button', { name: 'Dừng toàn bộ', exact: true }).click(); expect(await panel.count()).toBe(0);
  } finally { await page.close(); }
}, 45000);
