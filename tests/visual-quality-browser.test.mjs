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

it('normal-launch preference survives fresh browser contexts and a different ephemeral port',async()=>{
 const {bindVisualPreferences,loadVisualPreference}=await import('../integrations/visual-preferences.mjs');
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'fisch-quality-browser-')),file=join(dir,'preferences.json');
 const servers=[];let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(let i=0;i<2;i++){
   const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();servers.push(server);
   const origin=server.resolvedUrls.local[0].replace(/\/$/,'');const page=await browser.newPage();
   await bindVisualPreferences(page,origin,{file});await page.goto(origin+'/live.html');
   await page.waitForFunction(expected=>window.fischLive?.metrics().simulatedParticles===expected,i===0?2000:8000);
   if(i===0){
    await page.locator('.camera-options>summary').click();await page.locator('#visual-quality').selectOption('8000');
    await expect.poll(()=>loadVisualPreference(file)).toBe(8000);
    expect(await page.evaluate(()=>window.fischLive.metrics().particles)).toBe(2000);
   }else{
    expect(await page.evaluate(()=>window.fischLive.metrics().particles)).toBe(8000);
    expect(await page.locator('video').evaluate(v=>v.srcObject)).toBe(null);
   }
   await page.close();
  }
  expect(servers[0].resolvedUrls.local[0]).not.toBe(servers[1].resolvedUrls.local[0]);
 }finally{await browser?.close();for(const server of servers)await server.close();rmSync(dir,{recursive:true,force:true});}
},60000);

import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadVisualPreference,saveVisualPreference,bindVisualPreferences} from '../integrations/visual-preferences.mjs';
it('launcher preference persists bounded data independently of browser origins and rejects unsafe file shapes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fisch-quality-')),file=join(dir,'preferences.json');
 try {
  expect(loadVisualPreference(file)).toBe(2000);
  expect(saveVisualPreference(8000,file)).toBe(true);expect(loadVisualPreference(file)).toBe(8000);
  expect(JSON.parse(readFileSync(file,'utf8'))).toEqual({schemaVersion:1,particles:8000});
  expect(saveVisualPreference(999999,file)).toBe(false);expect(loadVisualPreference(file)).toBe(8000);
  writeFileSync(file,JSON.stringify({schemaVersion:1,particles:8000,extra:true}));expect(loadVisualPreference(file)).toBe(2000);
  writeFileSync(file,'x'.repeat(129));expect(loadVisualPreference(file)).toBe(2000);expect(saveVisualPreference(2000,file)).toBe(false);
  expect(saveVisualPreference(8000,dir)).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('launcher binding accepts only its own live main frame and bounded preference, never arbitrary host data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fisch-quality-')),file=join(dir,'preferences.json');let handler,seed;
 const frame={url:()=> 'http://127.0.0.1:1234/live.html?fixture=synthetic'};
 const page={mainFrame:()=>frame,isClosed:()=>false,exposeBinding:async(_n,h)=>{handler=h;},addInitScript:async(_fn,arg)=>{seed=arg;}};
 try{
  saveVisualPreference(8000,file);await bindVisualPreferences(page,'http://127.0.0.1:1234',{file});
  expect(seed.value).toBe(8000);
  expect(handler({page,frame:{}},2000)).toBe(false);
  expect(handler({page:{},frame},2000)).toBe(false);
  expect(handler({page,frame},{path:'elsewhere',particles:2000})).toBe(false);
  expect(handler({page,frame},2000)).toBe(true);expect(loadVisualPreference(file)).toBe(2000);
  frame.url=()=> 'http://127.0.0.1:1234/other.html';expect(handler({page,frame},8000)).toBe(false);
  frame.url=()=> 'http://127.0.0.1:9999/live.html';expect(handler({page,frame},8000)).toBe(false);
  frame.url=()=> 'http://example.com/live.html';expect(handler({page,frame},8000)).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it.skipIf(process.platform==='win32')('refuses symlink preference files and direct preference directories',async()=>{
 const {symlinkSync,mkdirSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'fisch-quality-links-')),real=join(dir,'real'),alias=join(dir,'alias');
 try{
  mkdirSync(real);const target=join(real,'preferences.json');expect(saveVisualPreference(8000,target)).toBe(true);
  const linked=join(dir,'linked.json');symlinkSync(target,linked);
  expect(loadVisualPreference(linked)).toBe(2000);expect(saveVisualPreference(2000,linked)).toBe(false);
  symlinkSync(real,alias,'dir');expect(loadVisualPreference(join(alias,'preferences.json'))).toBe(2000);
  expect(saveVisualPreference(2000,join(alias,'preferences.json'))).toBe(false);expect(loadVisualPreference(target)).toBe(8000);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
