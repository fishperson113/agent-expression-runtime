import { beforeAll, afterAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
let server, browser;
const ready = { generation: 1, revision: 1, available: true, canSend: true, canCancel: false, pending: false, stopping: false, waiting: false, error: '', messages: [] };
beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}, 45000);
afterAll(async () => { await browser?.close(); await server?.close(); });
async function open(synthetic = true) {
  const page = await browser.newPage(); const calls = [];
  await page.exposeBinding('fischLiveConversation', async (_, value) => { calls.push(value); return { status: value.action === 'send' ? 'accepted' : 'stopping' }; });
  await page.addInitScript("window.qaMediaCalls=0;navigator.mediaDevices.getUserMedia=()=>{window.qaMediaCalls++;throw Error('no media')}");
  await page.goto(server.resolvedUrls.local[0] + (synthetic ? 'live.html?fixture=synthetic' : 'live.html')); await page.waitForFunction(() => typeof window.fischLive?.conversationStatus === 'function');
  return { page, calls, panel: page.locator('.fisch-conversation'), input: page.getByLabel('Nhắn trong phiên hiện tại', { exact: true }) };
}
it('connects explicit UI send/cancel to the existing binding, clears scopes and wipes on stop', async () => {
  const { page, calls, panel, input } = await open();
  try {
    expect(await input.isDisabled()).toBe(true); expect(await panel.textContent()).toContain('terminal Native Codex'); expect(calls).toEqual([]);
    await page.evaluate(value => window.fischLive.conversationStatus(value), ready); await input.fill('Một ý tưởng của tôi');
    await panel.getByRole('button', { name: 'Gửi', exact: true }).click(); await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual({ action: 'send', generation: 1, text: 'Một ý tưởng của tôi' });
    await page.evaluate(value => window.fischLive.conversationStatus(value), { ...ready, revision: 2, canSend: false, canCancel: true, messages: [{ id: 'real', turn: 't', role: 'assistant', text: '<img src=x onerror=alert(1)>', status: 'streaming', truncated: false }] });
    expect(await panel.locator('img').count()).toBe(0); await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).click(); expect(calls[1]).toEqual({ action: 'cancel', generation: 1 });
    await input.fill('Bản nháp cũ'); await page.evaluate(value => window.fischLive.conversationStatus(value), { ...ready, generation: 2, revision: 3 }); expect(await input.inputValue()).toBe('');
    await input.fill('Không giữ sau dừng'); await page.getByRole('button', { name: 'Dừng toàn bộ', exact: true }).click();
    await page.evaluate(value => window.fischLive.conversationStatus(value), ready); expect(await panel.count()).toBe(0);
    await page.reload(); await page.waitForFunction(() => !!window.fischLive); expect(await page.locator('.fisch-conversation textarea').inputValue()).toBe('');
  } finally { await page.close(); }
}, 45000);
it('keeps real transcript scrolling internally and composer/stop reachable across required viewports', async () => {
  const { page, panel, input } = await open(false);
  try {
    const messages = Array.from({ length: 80 }, (_, index) => ({ id: 'm' + index, turn: 't', role: index % 2 ? 'assistant' : 'user', text: 'Nội dung tổng hợp '.repeat(20), status: 'completed', truncated: false }));
    await page.evaluate(value => window.fischLive.conversationStatus(value), { ...ready, messages });
    let revision = 1;
    for (const [width, height] of [[1440, 900], [1280, 720], [390, 844], [320, 568], [844, 390], [640, 450]]) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const node of [input, panel.getByRole('button', { name: 'Gửi', exact: true }), panel.getByRole('button', { name: 'Dừng trả lời', exact: true }), ...['#stop-all', '#motion', '#cancel', '#camera-start', '.camera-options > summary'].map(selector => page.locator(selector))]) {
        expect(await node.evaluate(element => { const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.width > 0 && r.height > 0 && r.y >= 0 && r.bottom <= innerHeight && (hit === element || element.contains(hit)); })).toBe(true);
      }
      expect(await panel.locator('ol').evaluate(node => node.clientHeight > 0 && node.scrollHeight > node.clientHeight)).toBe(true);
      await page.evaluate(value => window.fischLive.conversationStatus(value), { ...ready, revision: ++revision, canSend: false, error: 'conversation_unknown', messages });
      expect(await input.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
      expect(await panel.locator('ol').evaluate(node => node.clientHeight > 0)).toBe(true);
      if (width > 700) { expect(await page.locator('#fullscreen').evaluate(node => { const r = node.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === node; })).toBe(true); const left = await page.locator('.body-panel').boundingBox(), right = await page.locator('.camera-panel').boundingBox(); expect(left.width / right.width).toBeCloseTo(2, 1); }
      expect(await page.locator('video').evaluate(node => node.srcObject)).toBeNull();
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(value => window.fischLive.conversationStatus(value), { ...ready, revision: ++revision, available: false, canSend: false });
    expect(await input.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await page.evaluate(() => { for (let i = 0; i < 40; i++) window.fischLive.logActivity('Hoạt động tổng hợp '.repeat(15)); });
    await page.locator('.technical-log summary').click(); expect(await page.locator('.technical-log dialog').getAttribute('open')).not.toBeNull(); expect(await page.locator('#agent-activity').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    expect(await page.locator('#stop-all').evaluate(node => { const r = node.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === node; })).toBe(true);
    await page.keyboard.press('Escape'); expect(await page.locator('dialog[open]').count()).toBe(0);
    expect(await page.evaluate(() => window.qaMediaCalls)).toBe(0);
  } finally { await page.close(); }
}, 45000);
