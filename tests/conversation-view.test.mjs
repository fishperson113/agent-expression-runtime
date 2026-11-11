import { beforeAll, afterAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
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
    const NativeResizeObserver = window.ResizeObserver; window.heldConversationResizes=[];
    window.ResizeObserver = class extends NativeResizeObserver { constructor(callback) { super((entries, observer) => {
      if(window.holdConversationResize)window.heldConversationResizes.push(()=>callback(entries,observer));else callback(entries,observer);
    }); } };
    const container = document.createElement('div'); container.id='conversation-test'; container.style='position:fixed;inset:0;background:#080e14;z-index:20;display:flex';document.body.append(container);
    window.calls=[]; window.sideEffects=0;window.fetch=()=>{window.sideEffects++;throw Error('network')};
    for(const method of ['getItem','setItem','removeItem'])Storage.prototype[method]=()=>{window.sideEffects++;throw Error('storage')};
    navigator.mediaDevices.getUserMedia=()=>{window.sideEffects++;throw Error('media')};
    navigator.clipboard.writeText=()=>{window.sideEffects++;throw Error('clipboard')};
    window.conversation = mountConversation(container, value => {window.calls.push(value);return new Promise((resolve,reject)=>{window.resolveRequest=resolve;window.rejectRequest=reject;window[value.action+'Resolve']=resolve;window[value.action+'Reject']=reject})});
  })()`);
  return { page, panel: page.locator('#conversation-test .fisch-conversation'), input: page.locator('#conversation-test').getByLabel('Nhắn trong phiên hiện tại', { exact: true }) };
}
async function settledReaderScroll(list) {
  await list.evaluate(node => new Promise((resolve, reject) => {
    let last = node.scrollTop, stable = 0, frames = 0;
    const tick = () => {
      stable = node.scrollTop === last ? stable + 1 : 0; last = node.scrollTop;
      if (stable === 5) resolve();
      else if (++frames === 120) reject(Error('reader_scroll_never_settled'));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
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

it('honors a new reader scroll while a transcript resize callback is pending', async () => {
  const { page, panel, input } = await open();
  try {
    const messages = Array.from({ length: 20 }, (_, i) => ({ id: 'pending' + i, turn: 't', role: 'assistant', text: 'Đang đọc nội dung cũ '.repeat(20), status: 'completed', truncated: false }));
    await page.evaluate(value => window.conversation.project(value), { ...ready, messages });
    const list=panel.locator('ol');await list.focus();await page.keyboard.press('End');
    await expect.poll(()=>list.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)).toBeLessThanOrEqual(1);
    await input.fill('Bản nháp trong lúc bố cục đổi.');await list.focus();
    await page.evaluate(()=>{window.holdConversationResize=true;const panel=document.querySelector('#conversation-test .fisch-conversation');panel.style.maxHeight=(panel.clientHeight-120)+'px';});
    await expect.poll(()=>page.evaluate(()=>window.heldConversationResizes.length)).toBeGreaterThan(0);
    const oldTop=await list.evaluate(node=>node.scrollTop);await page.keyboard.press('PageUp');
    await expect.poll(()=>list.evaluate(node=>node.scrollTop)).toBeLessThan(oldTop-10);
    await list.evaluate(node=>new Promise(resolve=>{let last=node.scrollTop,stable=0;const tick=()=>{stable=node.scrollTop===last?stable+1:0;last=node.scrollTop;if(stable===5)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);}));
    const readerTop=await list.evaluate(node=>node.scrollTop);
    await page.evaluate(()=>{window.holdConversationResize=false;for(const callback of window.heldConversationResizes.splice(0))callback();});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    expect(await list.evaluate(node=>node.scrollTop)).toBe(readerTop);
    await page.evaluate(value=>window.conversation.project(value),{...ready,revision:2,messages:[...messages,{...messages[0],id:'pending-latest',text:'Nội dung đến sau khi người dùng đọc lên.'}]});
    expect(await list.evaluate(node=>node.scrollTop)).toBe(readerTop);expect(await input.inputValue()).toBe('Bản nháp trong lúc bố cục đổi.');
  } finally { await page.close(); }
},45000);

it.each(['pointer', 'touch'])('preserves an ongoing %s reading gesture across pending transcript resize', async kind => {
  const { page, panel, input } = await open();
  try {
    const messages=Array.from({length:20},(_,i)=>({id:'gesture'+i,turn:'t',role:'assistant',text:'Nội dung đọc khi giữ thao tác '.repeat(20),status:'completed',truncated:false}));
    await page.evaluate(value=>window.conversation.project(value),{...ready,messages});
    const list=panel.locator('ol');await list.focus();await page.keyboard.press('End');
    await expect.poll(()=>list.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)).toBeLessThanOrEqual(1);
    await input.fill('Bản nháp trong thao tác đọc liên tục.');
    const readerTop=await list.evaluate((node,mode)=>{
      window.holdConversationResize=true;
      const event=(phase)=>{
        if(mode==='pointer')return new PointerEvent('pointer'+phase,{bubbles:true,pointerId:7,pointerType:'touch',buttons:phase==='up'?0:1});
        const contact=new Touch({identifier:7,target:node,clientX:30,clientY:phase==='down'?400:240});
        return new TouchEvent('touch'+(phase==='down'?'start':phase==='up'?'end':'move'),{bubbles:true,touches:phase==='up'?[]:[contact],changedTouches:[contact]});
      };
      node.dispatchEvent(event('down'));
      const panel=node.closest('.fisch-conversation');panel.style.maxHeight=(panel.clientHeight-120)+'px';
      node.scrollTop=Math.max(0,node.scrollTop-160);const top=node.scrollTop;
      node.dispatchEvent(event('move'));node.dispatchEvent(new Event('scroll'));
      return top;
    },kind);
    await expect.poll(()=>page.evaluate(()=>window.heldConversationResizes.length)).toBeGreaterThan(0);
    await page.evaluate(()=>{window.holdConversationResize=false;for(const callback of window.heldConversationResizes.splice(0))callback();});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    expect(await list.evaluate(node=>node.scrollTop)).toBe(readerTop);
    await list.evaluate((node,mode)=>node.dispatchEvent(mode==='pointer'?new PointerEvent('pointerup',{bubbles:true,pointerId:7,pointerType:'touch'}):new TouchEvent('touchend',{bubbles:true})),kind);
    await page.evaluate(value=>window.conversation.project(value),{...ready,revision:2,messages:[...messages,{...messages[0],id:'gesture-latest',text:'Lời mới đến sau thao tác đang diễn ra.'}]});
    expect(await list.evaluate(node=>node.scrollTop)).toBe(readerTop);expect(await input.inputValue()).toBe('Bản nháp trong thao tác đọc liên tục.');
    if(process.env.FISCH_SCROLL_EVIDENCE)writeFileSync(process.env.FISCH_SCROLL_EVIDENCE+'/ongoing-'+kind+'.json',JSON.stringify({actualModelCalls:0,nativeHardwareAcceptance:false,readerTop,after:await list.evaluate(node=>node.scrollTop)}));
  } finally { await page.close(); }
},45000);

it.each(['pointer', 'touch'])('ignores %s movement without contact while following a resizing transcript', async kind => {
  const { page, panel } = await open();
  try {
    const messages=Array.from({length:20},(_,i)=>({id:'hover'+i,turn:'t',role:'assistant',text:'Nội dung vẫn đang theo cuối '.repeat(20),status:'completed',truncated:false}));
    await page.evaluate(value=>window.conversation.project(value),{...ready,messages});
    const list=panel.locator('ol');await list.focus();await page.keyboard.press('End');
    await expect.poll(()=>list.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)).toBeLessThanOrEqual(1);
    await list.evaluate((node,mode)=>{
      window.holdConversationResize=true;
      const panel=node.closest('.fisch-conversation');panel.style.maxHeight=(panel.clientHeight-120)+'px';
      void node.clientHeight;
      node.dispatchEvent(mode==='pointer'?new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',buttons:0}):new TouchEvent('touchmove',{bubbles:true,touches:[]}));
      node.dispatchEvent(new Event('scroll'));
    },kind);
    await expect.poll(()=>page.evaluate(()=>window.heldConversationResizes.length)).toBeGreaterThan(0);
    await page.evaluate(()=>{window.holdConversationResize=false;for(const callback of window.heldConversationResizes.splice(0))callback();});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    expect(await list.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)).toBeLessThanOrEqual(1);
    if(process.env.FISCH_SCROLL_EVIDENCE)writeFileSync(process.env.FISCH_SCROLL_EVIDENCE+'/no-contact-'+kind+'.json',JSON.stringify({actualModelCalls:0,nativeHardwareAcceptance:false,bottomGap:await list.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)}));
  } finally { await page.close(); }
},45000);

it('settles total-only transcript reflow without losing later reader scrolling', async () => {
  const { page, panel } = await open();
  try {
    const messages=Array.from({length:20},(_,i)=>({id:'reflow'+i,turn:'t',role:'assistant',text:'Nội dung trước khi font đổi '.repeat(20),status:'completed',truncated:false}));
    await page.evaluate(value=>window.conversation.project(value),{...ready,messages});
    const list=panel.locator('ol');await list.focus();await page.keyboard.press('End');
    await expect.poll(()=>list.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)).toBeLessThanOrEqual(1);
    const height=await list.evaluate(node=>node.clientHeight);
    await page.evaluate(value=>{document.querySelector('#conversation-test ol').style.lineHeight='2';window.conversation.project(value);},{...ready,revision:2,messages});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    expect(await list.evaluate(node=>node.clientHeight)).toBe(height);
    await page.keyboard.press('PageUp');
    await list.evaluate(node=>new Promise(resolve=>{let last=node.scrollTop,stable=0;const tick=()=>{stable=node.scrollTop===last?stable+1:0;last=node.scrollTop;if(stable===5)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);}));
    const readerTop=await list.evaluate(node=>node.scrollTop);
    await page.evaluate(value=>window.conversation.project(value),{...ready,revision:3,messages:[...messages,{...messages[0],id:'reflow-new',text:'Nội dung đến sau thao tác đọc.'}]});
    expect(await list.evaluate(node=>node.scrollTop)).toBe(readerTop);
  } finally { await page.close(); }
},45000);
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

it.each(['following', 'reading-earlier', 'resumed-following'])('preserves %s intent when public context and captions resize the transcript', async intent => {
  const { page, panel, input } = await open();
  try {
    const messages = Array.from({ length: 20 }, (_, i) => ({ id: 'scroll' + i, turn: 't', role: 'assistant', text: 'Nội dung phiên '.repeat(20), status: 'completed', truncated: false }));
    await page.evaluate(value => {
      const shell = document.querySelector('#conversation-test'); shell.style.flexDirection = 'column';
      shell.querySelector('.fisch-conversation').style.flex = '1';
      const brief = document.createElement('p'); brief.id = 'scroll-test-brief'; brief.hidden = true;
      brief.style.cssText = 'height:100px;max-height:100px;flex:none;overflow:auto;margin:0;white-space:pre-wrap';
      brief.textContent = 'Brief công khai tổng hợp\n'.repeat(30); shell.prepend(brief);
      window.conversation.project(value);
    }, { ...ready, messages });
    const list = panel.locator('ol');
    await list.focus(); await page.keyboard.press('End');
    await expect.poll(() => list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
    await settledReaderScroll(list);
    if (intent !== 'following') {
      await list.hover(); await page.mouse.wheel(0, -450);
      await expect.poll(() => list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(40);
      await settledReaderScroll(list);
    }
    if (intent === 'resumed-following') {
      await list.focus(); await page.keyboard.press('End'); await settledReaderScroll(list);
      expect(await list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
    }
    const before = await list.evaluate(node => ({ top: node.scrollTop, height: node.clientHeight, total: node.scrollHeight }));
    await input.fill('Bản nháp không được mất khi viewport đổi.');
    await page.evaluate(() => {
      document.querySelector('#scroll-test-brief').hidden = false;
      window.conversation.reaction({ requestId: 'resize-caption', text: 'Lời Fisch công khai tổng hợp. '.repeat(15) });
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await list.evaluate(node => node.clientHeight)).toBeLessThan(before.height - 40);
    if (intent !== 'reading-earlier') expect(await list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
    await page.evaluate(() => {
      document.querySelector('#scroll-test-brief').scrollTop = 25;
      document.querySelector('#conversation-test .observation-messages').scrollTop = 20;
    });
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2,
      messages: [...messages, { ...messages[0], id: 'scroll-latest', text: 'Nội dung mới nhất phải xem được khi đang theo cuối.' }] });
    if (intent !== 'reading-earlier') expect(await list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
    else expect(await list.evaluate(node => node.scrollTop)).toBe(before.top);
    expect(await input.inputValue()).toBe('Bản nháp không được mất khi viewport đổi.');
    expect(await page.locator('#scroll-test-brief').evaluate(node => node.scrollTop)).toBe(25);
    expect(await panel.locator('.observation-messages').evaluate(node => node.scrollTop)).toBe(20);
    if (process.env.FISCH_SCROLL_EVIDENCE) {
      writeFileSync(process.env.FISCH_SCROLL_EVIDENCE + '/' + intent + '.json', JSON.stringify({ actualModelCalls: 0, before, after: await list.evaluate(node => ({ top: node.scrollTop, height: node.clientHeight, total: node.scrollHeight })) }));
      await page.screenshot({ path: process.env.FISCH_SCROLL_EVIDENCE + '/' + intent + '.png' });
    }
    await page.evaluate(() => { window.conversation.clear(); });
    await page.evaluate(value => window.conversation.project(value), { ...ready, generation: 2, revision: 3, messages });
    expect(await list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  } finally { await page.close(); }
}, 45000);

it.each(['wheel', 'keyboard'])('keeps real %s reading intent when public layout changes during that input', async kind => {
  const { page, panel } = await open();
  try {
    const messages = Array.from({ length: 20 }, (_, i) => ({ id: 'input-resize' + i, turn: 't', role: 'assistant', text: 'Nội dung phiên '.repeat(20), status: 'completed', truncated: false }));
    await page.evaluate(value => {
      const shell = document.querySelector('#conversation-test'); shell.style.flexDirection = 'column';
      shell.querySelector('.fisch-conversation').style.flex = '1';
      const brief = document.createElement('p'); brief.id = 'input-resize-brief'; brief.hidden = true;
      brief.style.cssText = 'height:100px;flex:none;margin:0'; shell.prepend(brief);
      window.conversation.project(value);
    }, { ...ready, messages });
    const list = panel.locator('ol'); await list.focus(); await page.keyboard.press('End'); await settledReaderScroll(list);
    expect(await list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
    await list.evaluate((node, type) => node.addEventListener(type, () => {
      document.querySelector('#input-resize-brief').hidden = false;
      window.conversation.reaction({ requestId: 'during-input', text: 'Lời Fisch công khai. '.repeat(15) });
    }, { once: true }), kind === 'wheel' ? 'wheel' : 'keydown');
    if (kind === 'wheel') { await list.hover(); await page.mouse.wheel(0, -450); }
    else await page.keyboard.press('PageUp');
    await expect.poll(() => page.locator('#input-resize-brief').isVisible()).toBe(true);
    await settledReaderScroll(list);
    expect(await list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(40);
    const before = await list.evaluate(node => node.scrollTop);
    await page.evaluate(value => window.conversation.project(value), { ...ready, revision: 2, messages: [...messages, { ...messages[0], id: 'input-resize-new', text: 'Câu đến sau thao tác đọc.' }] });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await list.evaluate(node => node.scrollTop)).toBe(before);
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
