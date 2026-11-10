import { beforeAll, afterAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
let server, browser;
const ready = { generation: 1, revision: 1, ownerTurn: null, available: true, canSend: true, canCancel: false, pending: false, stopping: false, waiting: false, error: '', messages: [] };
beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}, 45000);
afterAll(async () => { await browser?.close(); await server?.close(); });
async function open() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(server.resolvedUrls.local[0] + 'live.html?fixture=synthetic'); await page.waitForFunction(() => !!window.fischLive);
  await page.evaluate(`(async () => {
    const { mountConversation } = await import('/src/live/conversation-view.ts');
    const container = document.createElement('div'); container.id='conversation-test'; container.style='position:fixed;inset:0;background:#080e14;z-index:20;display:flex';document.body.append(container);
    window.calls=[]; window.sideEffects=0;window.fetch=()=>{window.sideEffects++;throw Error('network')};
    for(const method of ['getItem','setItem','removeItem'])Storage.prototype[method]=()=>{window.sideEffects++;throw Error('storage')};
    navigator.mediaDevices.getUserMedia=()=>{window.sideEffects++;throw Error('media')};
    navigator.clipboard.writeText=()=>{window.sideEffects++;throw Error('clipboard')};
    window.conversation = mountConversation(container, value => {window.calls.push(value);return new Promise((resolve,reject)=>{window.resolveRequest=resolve;window.rejectRequest=reject;window[value.action+'Resolve']=resolve;window[value.action+'Reject']=reject})});
  })()`);
  return { page, panel: page.locator('#conversation-test .fisch-conversation'), input: page.locator('#conversation-test').getByLabel('Nhắn trong phiên hiện tại', { exact: true }) };
}
it('shows only real projected plaintext, counts UTF8 bytes and sends explicitly without side effects', async () => {
  const { page, panel, input } = await open();
  try {
    expect(await panel.getByRole('button', { name: 'Gửi', exact: true }).isDisabled()).toBe(true);
    expect(await panel.textContent()).toContain('terminal Native Codex');
    await page.evaluate(value => window.conversation.project(value), { ...ready, messages: [{ id: 'a', turn: 't', role: 'assistant', text: '<img src=x onerror=alert(1)>', status: 'unknown', truncated: true }] });
    expect(await panel.locator('img').count()).toBe(0); expect(await panel.textContent()).toContain('Chưa rõ kết quả');
    await input.fill('🙂'.repeat(4001)); expect(await panel.textContent()).toContain('16004 / 16000'); expect(await panel.getByRole('button', { name: 'Gửi', exact: true }).isDisabled()).toBe(true);
    await input.fill('Một hình ảnh tôi muốn thử'); await input.press('Enter'); expect(await page.evaluate(() => window.calls.length)).toBe(0);
    await panel.getByRole('button', { name: 'Gửi', exact: true }).click();
    expect(await page.evaluate(() => window.calls)).toEqual([{ action: 'send', generation: 1, text: 'Một hình ảnh tôi muốn thử\n' }]);
    await page.evaluate(() => window.rejectRequest(Error('conversation_rejected'))); await expect.poll(() => panel.locator('.conversation-status').textContent()).toContain('chưa được nhận');
    expect(await input.inputValue()).toContain('Một hình ảnh'); expect(await page.evaluate(() => window.sideEffects)).toBe(0);
  } finally { await page.close(); }
}, 45000);
it('keeps same-scope drafts, clears successful switches and ignores old results, unknown prevents resend but allows interrupt', async () => {
  const { page, panel, input } = await open();
  try {
    await page.evaluate(value => window.conversation.project(value), ready); await input.fill('Bản nháp phiên đầu');
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2, canSend: false }); expect(await input.inputValue()).toBe('Bản nháp phiên đầu');
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 3 }); await panel.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.evaluate(value => window.conversation.project(value), { ...ready, generation: 2, revision: 4 }); expect(await input.inputValue()).toBe('');
    await input.fill('Bản nháp mới'); await page.evaluate(() => window.rejectRequest(Error('PRIVATE_ERROR'))); expect(await input.inputValue()).toBe('Bản nháp mới'); expect(await panel.textContent()).not.toContain('PRIVATE_ERROR');
    await panel.getByRole('button', { name: 'Gửi', exact: true }).click(); await page.evaluate(() => window.rejectRequest(Error('conversation_unknown')));
    await expect.poll(() => panel.getByRole('button', { name: 'Gửi', exact: true }).isDisabled()).toBe(true);
    await page.evaluate(value => window.conversation.project(value), { ...ready, generation: 2, revision: 5, canSend: false, canCancel: true, ownerTurn: 'turn-a', error: 'conversation_unknown' });
    await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).click(); expect((await page.evaluate(() => window.calls)).at(-1)).toEqual({ action: 'cancel', generation: 2 });
    await page.evaluate(() => window.resolveRequest({ status: 'stopping' }));
    await page.evaluate(() => window.conversation.dispose()); expect(await panel.count()).toBe(0);
  } finally { await page.close(); }
}, 45000);
it('bounds history, fails closed on malformed data, clears private fields and fits a constrained panel', async () => {
  const { page, panel, input } = await open();
  try {
    const messages = Array.from({ length: 80 }, (_, i) => ({ id: 'm' + i, turn: 't', role: i % 2 ? 'assistant' : 'user', text: 'Nội dung tổng hợp '.repeat(12), status: 'completed', truncated: false }));
    await page.evaluate(value => window.conversation.project(value), { ...ready, messages }); expect(await panel.locator('li').count()).toBe(80);
    expect(await panel.locator('ol').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    expect(await input.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await input.fill('Riêng tư trong phiên'); await page.evaluate(() => window.conversation.clear()); expect(await input.inputValue()).toBe(''); expect(await panel.locator('li').count()).toBe(0);
    await page.evaluate(value => window.conversation.project(value), { ...ready, messages: [...messages, messages[0]] }); expect(await panel.getByRole('button', { name: 'Gửi', exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => { window.getters = 0; window.conversation.project({ get generation() { window.getters++; return 1; } }); window.conversation.project(new Proxy({}, { ownKeys() { throw Error('PRIVATE'); } })); });
    expect(await page.evaluate(() => window.getters)).toBe(0); expect(await panel.textContent()).not.toContain('PRIVATE');
    expect(await page.evaluate(() => window.sideEffects)).toBe(0);
  } finally { await page.close(); }
}, 45000);

it('interrupts a canonical turn while send acknowledgment remains pending', async () => {
  const { page, panel, input } = await open();
  try {
    await page.evaluate(value => window.conversation.project(value), ready); await input.fill('Thử một ý tưởng');
    await panel.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2, pending: true, canSend: false, canCancel: true, ownerTurn: 'turn-a' });
    await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).click();
    expect((await page.evaluate(() => window.calls)).map(value => value.action)).toEqual(['send', 'cancel']);
    await page.evaluate(() => { window.cancelResolve({ status: 'stopping' }); window.sendReject(Error('conversation_unknown')); });
    await expect.poll(() => panel.locator('.conversation-status').textContent()).toContain('Không gửi lại');
    expect(await input.inputValue()).toBe('Thử một ý tưởng');
  } finally { await page.close(); }
}, 45000);

it('waits for a fresh authoritative snapshot after send acknowledgment and rejects stale snapshots', async () => {
  const { page, panel, input } = await open();
  try {
    await page.evaluate(value => window.conversation.project(value), ready); await input.fill('Một bước tiếp theo');
    await panel.getByRole('button', { name: 'Gửi', exact: true }).click(); await page.evaluate(() => window.sendResolve({ status: 'accepted' }));
    await expect.poll(() => input.inputValue()).toBe(''); await input.fill('Không gửi lặp');
    expect(await panel.getByRole('button', { name: 'Gửi', exact: true }).isDisabled()).toBe(true);
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 3 });
    expect(await panel.getByRole('button', { name: 'Gửi', exact: true }).isDisabled()).toBe(false);
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2, canSend: false });
    expect(await panel.getByRole('button', { name: 'Gửi', exact: true }).isDisabled()).toBe(false);
  } finally { await page.close(); }
}, 45000);

it('keeps the stale projection fence after malformed data or explicit clearing', async () => {
  const { page, panel, input } = await open();
  try {
    const newest = { ...ready, generation: 2, revision: 10 };
    await page.evaluate(value => window.conversation.project(value), newest); await input.fill('Nội dung hiện tại');
    await page.evaluate(() => window.conversation.project(null));
    await page.evaluate(value => window.conversation.project(value), { ...ready, messages: [{ id: 'old', turn: 'old', role: 'user', text: 'OLD_PRIVATE_TEXT', status: 'completed', truncated: false }] });
    expect(await panel.textContent()).not.toContain('OLD_PRIVATE_TEXT'); expect(await input.isDisabled()).toBe(true);
    await page.evaluate(value => window.conversation.project(value), newest); expect(await input.isDisabled()).toBe(true);
    await page.evaluate(value => window.conversation.project(value), { ...newest, revision: 11 }); expect(await input.isDisabled()).toBe(false);
    await page.evaluate(() => window.conversation.clear());
    await page.evaluate(value => window.conversation.project(value), { ...newest, revision: 11 }); expect(await input.isDisabled()).toBe(true);
  } finally { await page.close(); }
}, 45000);

it('accepts a fresh ready projection arriving before the send promise acknowledgment', async () => {
  const { page, panel, input } = await open();
  try {
    await page.evaluate(value => window.conversation.project(value), ready); await input.fill('Thử lượt đã hoàn tất');
    await panel.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2 });
    await page.evaluate(() => window.sendResolve({ status: 'accepted' })); await expect.poll(() => input.inputValue()).toBe('');
    await input.fill('Lượt tiếp theo'); expect(await panel.getByRole('button', { name: 'Gửi', exact: true }).isDisabled()).toBe(false);
  } finally { await page.close(); }
}, 45000);

it('keeps the reader position while new real transcript items arrive', async () => {
  const { page, panel } = await open();
  try {
    const messages = Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, turn: 't', role: 'assistant', text: 'Nội dung phiên '.repeat(20), status: 'completed', truncated: false }));
    await page.evaluate(value => window.conversation.project(value), { ...ready, messages });
    await panel.locator('ol').evaluate(node => { node.scrollTop = 100; });
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2, messages: [...messages, { ...messages[0], id: 'new', text: 'Câu trả lời mới' }] });
    expect(await panel.locator('ol').evaluate(node => node.scrollTop)).toBe(100);
  } finally { await page.close(); }
}, 45000);

it.each(['terminal-first', 'error-first'])('clears only superseded cancellation errors with %s projection', async order => {
  const { page, panel, input } = await open();
  try {
    await page.evaluate(value => window.conversation.project(value), { ...ready, canSend: false, canCancel: true, ownerTurn: 'turn-a' });
    await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).click();
    if (order === 'error-first') {
      await page.evaluate(() => window.cancelReject(Error('conversation_stop_unconfirmed')));
      await expect.poll(() => panel.locator('.conversation-status').textContent()).toContain('Chưa xác nhận đã dừng');
    }
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 3 });
    if (order === 'terminal-first') await page.evaluate(() => window.cancelReject(Error('conversation_stop_unconfirmed')));
    await expect.poll(() => panel.locator('.conversation-status').textContent()).toContain('Bạn có thể nhắn');
    await input.fill('Yêu cầu mới'); await panel.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.evaluate(() => window.sendReject(Error('conversation_unknown')));
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 4 });
    await expect.poll(() => panel.locator('.conversation-status').textContent()).toContain('Không gửi lại');
    expect(await panel.getByRole('button', { name: 'Gửi', exact: true }).isDisabled()).toBe(true);
  } finally { await page.close(); }
}, 45000);

it('keeps a definite stop rejection actionable and an unknown stopping outcome sticky', async () => {
  const { page, panel } = await open();
  try {
    await page.evaluate(value => window.conversation.project(value), { ...ready, canSend: false, canCancel: true, ownerTurn: 'turn-a' });
    await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).click();
    await page.evaluate(() => window.cancelReject(Error('conversation_stop_unconfirmed')));
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2, canSend: false, canCancel: true, ownerTurn: 'turn-a', error: 'conversation_stop_unconfirmed' });
    expect(await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).isDisabled()).toBe(false);
    await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).click();
    await page.evaluate(() => window.cancelReject(Error('conversation_stop_unconfirmed')));
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 3, canSend: false, stopping: true, error: 'conversation_stop_unconfirmed' });
    expect(await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).isDisabled()).toBe(true);
    expect(await panel.locator('.conversation-status').textContent()).toContain('Chưa xác nhận đã dừng');
  } finally { await page.close(); }
}, 45000);

it('ignores an old cancellation error when a new owner arrives without transcript or terminal projection', async () => {
  const { page, panel } = await open();
  try {
    await page.evaluate(value => window.conversation.project(value), { ...ready, canSend: false, canCancel: true, ownerTurn: 'turn-a' });
    await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).click();
    await page.evaluate(() => { window.oldCancelReject = window.cancelReject; });
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2, canSend: false, canCancel: true, ownerTurn: 'turn-b' });
    await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).click();
    await page.evaluate(() => window.oldCancelReject(Error('conversation_stop_unconfirmed')));
    expect(await panel.locator('.conversation-status').textContent()).not.toContain('Chưa xác nhận đã dừng');
    expect(await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).isDisabled()).toBe(true);
    await page.evaluate(() => window.cancelResolve({ status: 'stopping' }));
  } finally { await page.close(); }
}, 45000);

it.each(['send-last', 'cancel-last'])('keeps send uncertainty when an overlapping cancellation error is superseded (%s)', async order => {
  const { page, panel, input } = await open();
  try {
    await page.evaluate(value => window.conversation.project(value), ready); await input.fill('Một yêu cầu đang chờ');
    await panel.getByRole('button', { name: 'Gửi', exact: true }).click();
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2, ownerTurn: 'turn-a', canSend: false, canCancel: true, pending: true });
    await panel.getByRole('button', { name: 'Dừng trả lời', exact: true }).click();
    if (order === 'send-last') {
      await page.evaluate(() => window.cancelReject(Error('conversation_stop_unconfirmed')));
      await expect.poll(() => panel.locator('.conversation-status').textContent()).toContain('Chưa xác nhận đã dừng');
    }
    await page.evaluate(() => window.sendReject(Error('conversation_unknown')));
    if (order === 'cancel-last') await page.evaluate(() => window.cancelReject(Error('conversation_stop_unconfirmed')));
    await expect.poll(() => panel.locator('.conversation-status').textContent()).toContain('Không gửi lại');
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 3 });
    expect(await panel.locator('.conversation-status').textContent()).toContain('Không gửi lại');
    expect(await panel.getByRole('button', { name: 'Gửi', exact: true }).isDisabled()).toBe(true);
  } finally { await page.close(); }
}, 45000);

it.each(['Control', 'Meta'])('keeps plain Enter as newline and submits exactly once using the %s keyboard shortcut', async modifier => {
  const { page, panel, input } = await open();
  try {
    await page.evaluate(value => window.conversation.project(value), ready); await input.fill('Ý tưởng bằng bàn phím');
    await input.press('Enter'); expect(await input.inputValue()).toBe('Ý tưởng bằng bàn phím\n'); expect(await page.evaluate(() => window.calls.length)).toBe(0);
    await input.press(modifier + '+Enter'); await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(1);
    expect(await input.evaluate(node => node === document.activeElement)).toBe(true);
    await input.press(modifier + '+Enter'); expect(await page.evaluate(() => window.calls.length)).toBe(1);
    expect(await input.getAttribute('aria-keyshortcuts')).toBe('Control+Enter Meta+Enter');
    expect(await panel.locator('.conversation-count').textContent()).toContain('Ctrl/⌘+Enter');
    await page.evaluate(() => window.sendResolve({ status: 'accepted' })); await expect.poll(() => input.inputValue()).toBe('');
    expect(await input.evaluate(node => node === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 45000);

it('does not submit during IME, modifier variants, key repeat, busy/unknown or invalid input', async () => {
  const { page, input } = await open();
  try {
    await page.evaluate(value => window.conversation.project(value), ready); await input.fill('Bản nháp không gửi nhầm');
    const variants = [{ ctrlKey: true, isComposing: true }, { metaKey: true, isComposing: true },
      { ctrlKey: true, keyCode: 229 }, { ctrlKey: true, altKey: true }, { metaKey: true, altKey: true },
      { ctrlKey: true, shiftKey: true }, { metaKey: true, shiftKey: true }, { ctrlKey: true, metaKey: true },
      { ctrlKey: true, repeat: true }, { metaKey: true, repeat: true }];
    for (const value of variants) await input.evaluate((node, value) => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...value })), value);
    expect(await page.evaluate(() => window.calls.length)).toBe(0); expect(await input.inputValue()).toBe('Bản nháp không gửi nhầm');
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2, canSend: false, pending: true, ownerTurn: 'owned', canCancel: true });
    await input.press('Control+Enter'); expect(await page.evaluate(() => window.calls.length)).toBe(0);
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 3, canSend: false, error: 'conversation_unknown' });
    await input.press('Meta+Enter'); expect(await page.evaluate(() => window.calls.length)).toBe(0);
    await page.evaluate(value => window.conversation.project(value), { ...ready, generation: 2, revision: 4 });
    await input.fill('🙂'.repeat(4001)); await input.press('Control+Enter'); expect(await page.evaluate(() => window.calls.length)).toBe(0);
    await input.fill('   '); await input.press('Meta+Enter'); expect(await page.evaluate(() => window.calls.length)).toBe(0);
  } finally { await page.close(); }
}, 45000);
