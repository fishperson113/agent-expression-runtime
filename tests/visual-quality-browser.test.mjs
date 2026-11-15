import {expect,it} from 'vitest';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
it('quality is selected in existing settings without interrupting the current page, with bounded next-open fallback',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();let browser;
 try {
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+'live.html');
  const count=async()=>{await page.waitForFunction(()=>window.fischLive?.metrics().simulatedParticles);return page.evaluate(()=>{const m=window.fischLive.metrics();return [m.particles,m.simulatedParticles];});};
  expect(await count()).toEqual([2000,2000]);
  await page.locator('.camera-options>summary').click();
  await page.evaluate(()=>window.qualitySentinel='same-page');
  await page.locator('#visual-quality').selectOption('8000');
  expect(await page.evaluate(()=>window.qualitySentinel)).toBe('same-page');
  expect(await count()).toEqual([2000,2000]);
  expect(await page.locator('#visual-quality-note').textContent()).toContain('2.000');
  expect(await page.evaluate(()=>localStorage.getItem('fisch.visual-quality'))).toBe('8000');
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('quota fixture');};});
  await page.locator('#visual-quality').selectOption('2000');
  expect(await page.locator('#visual-quality').inputValue()).toBe('8000');
  expect(await page.evaluate(()=>localStorage.getItem('fisch.visual-quality'))).toBe('8000');
  await page.reload();expect(await count()).toEqual([8000,8000]);
  expect(await page.locator('video').evaluate(v=>v.srcObject)).toBe(null);
  await page.setViewportSize({width:375,height:812});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  await page.locator('.camera-options>summary').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#visual-quality').selectOption('2000');
  expect(await count()).toEqual([8000,8000]);await page.reload();expect(await count()).toEqual([2000,2000]);
  await page.evaluate(()=>localStorage.setItem('fisch.visual-quality','999999'));await page.reload();expect(await count()).toEqual([2000,2000]);
  expect(errors).toEqual([]);
 } finally {await browser?.close();await server.close();}
},60000);
