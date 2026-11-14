import { beforeAll, afterAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
let server,browser;
beforeAll(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});},45000);
afterAll(async()=>{await browser?.close();await server?.close();});
it('renders literal safe labels and arrows, resizes within panel, clears on revision and epoch',async()=>{
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
 await page.evaluate(`(async()=>{
  const {PresentationAnnotations,validateAnnotations}=await import('/src/live/presentation-annotations.ts');
  const host=document.createElement('div');host.id='annotation-test';host.style='position:fixed;top:0;left:0;width:320px;height:240px';document.body.append(host);
  window.scene={epoch:'e',revision:1};window.overlay=new PresentationAnnotations(host,()=>window.scene);
  window.paint=()=>window.overlay.set(validateAnnotations({labels:[{text:'<img src=x onerror=alert(1)>',x:1,y:1},{text:'Event time',x:0,y:0}],arrows:[{from:[0,0],to:[1,1]}]}),{epoch:window.scene.epoch,sceneRevision:window.scene.revision});window.paint();
 })()`);
 expect(await page.locator('#annotation-test img').count()).toBe(0);expect(await page.locator('#annotation-test tspan').allTextContents()).toContain('Event time');
 expect(await page.locator('#annotation-test path').count()).toBe(1);
 await page.locator('#annotation-test').evaluate(el=>el.style.width='180px');
 await page.waitForFunction(()=>document.querySelector('#annotation-test svg').getAttribute('viewBox')==='0 0 180 240');
 const bounded=await page.locator('#annotation-test rect').evaluateAll(nodes=>nodes.every(n=>Number(n.getAttribute('x'))>=0&&Number(n.getAttribute('x'))+Number(n.getAttribute('width'))<=180));expect(bounded).toBe(true);
 await page.evaluate(()=>window.scene.revision++);await page.waitForFunction(()=>!document.querySelector('#annotation-test svg').children.length);
 await page.evaluate(()=>{window.paint();window.scene.epoch='new';});await page.waitForFunction(()=>!document.querySelector('#annotation-test svg').children.length);
 await page.evaluate(()=>{window.clock=0;Object.defineProperty(performance,'now',{configurable:true,value:()=>window.clock});window.paint();window.clock=30000;});await page.waitForFunction(()=>!document.querySelector('#annotation-test svg').children.length);
 await page.evaluate(()=>{window.paint();window.overlay.clear();});expect(await page.locator('#annotation-test svg *').count()).toBe(0);
 await page.evaluate(()=>{
  window.clock=100;window.scene={epoch:'lease',revision:1};
  window.labels={labels:[{text:'Lease',x:.5,y:.5}],arrows:[]};
  window.scope={epoch:'lease',sceneRevision:1};
  window.overlay.set(window.labels,window.scope,1000);
  window.clock=900;window.overlay.set(window.labels,window.scope,1000);
 });
 expect(await page.locator('#annotation-test tspan').allTextContents()).toContain('Lease');
 await page.evaluate(()=>window.clock=1000);await page.waitForFunction(()=>!document.querySelector('#annotation-test svg').children.length);
 await page.evaluate(()=>{
  window.scene={epoch:'lease',revision:2};window.overlay.set({labels:[{text:'New scene',x:.5,y:.5}],arrows:[]},{epoch:'lease',sceneRevision:2},2000);
  window.overlay.set(window.labels,window.scope,3000); // old receipt cannot clear the new scene
  window.overlay.set(window.labels,{epoch:'lease',sceneRevision:2},999); // expired receipt cannot clear it either
 });
 expect(await page.locator('#annotation-test tspan').allTextContents()).toEqual(['New scene']);
 await page.evaluate(()=>window.overlay.dispose());expect(await page.locator('#annotation-test svg').count()).toBe(0);await page.close();
},30000);
