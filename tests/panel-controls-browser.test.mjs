import { beforeAll, afterAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
let server,browser;
const request=(id='r',method='item/commandExecution/requestApproval',details={command:'echo <img src=x onerror="window.PWNED=1">',cwd:'/public/project'})=>({type:'request',id,method,threadId:'t',turnId:'u',itemId:'i',details,choices:['accept','decline','cancel']});
beforeAll(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();browser=await chromium.launch({headless:true});},45000);
afterAll(async()=>{await browser?.close();await server?.close();});
async function open(mode='pending'){
 const page=await browser.newPage();await page.addInitScript(()=>{window.__mediaCalls=0;navigator.mediaDevices.getUserMedia=()=>{window.__mediaCalls++;throw Error('no media');};});
 await page.goto(server.resolvedUrls.local[0]+'live.html?fixture=synthetic');await page.waitForFunction(()=>!!window.fischLive);
 await page.evaluate("(async () => { window.__mountPanelControls=(await import('/src/live/panel-controls.ts')).mountPanelControls; })()");
 await page.evaluate(mode=>{window.__calls=[];window.__settle=[];
  window.__panel=window.__mountPanelControls(document.querySelector('.fisch-conversation'),value=>{window.__calls.push(value);return mode==='reject'?Promise.reject(Error('PRIVATE_ERROR_CANARY')):new Promise(resolve=>window.__settle.push(resolve));});},mode);
 return{page,panel:page.locator('.fisch-panel-controls')};
}
const project=(page,value)=>page.evaluate(value=>window.__panel.project(value),value);
it('shows actual command/cwd safely and sends once without inventing Native acknowledgement',async()=>{
 const {page,panel}=await open();try{
  await project(page,request());expect(await panel.locator('pre').allTextContents()).toEqual([request().details.command,'/public/project']);expect(await panel.locator('img').count()).toBe(0);
  await panel.getByRole('button',{name:'Cho phép lần này',exact:true}).click();await panel.getByRole('button',{name:'Cho phép lần này',exact:true}).evaluate(b=>b.click());
  expect(await page.evaluate(()=>window.__calls)).toEqual([{id:'r',decision:'accept'}]);expect(await panel.locator('button:enabled').count()).toBe(0);
  await page.evaluate(()=>window.__settle[0]({status:'submitted'}));expect(await panel.locator('article').count()).toBe(1);
  await project(page,{type:'resolved',id:'r',threadId:'t',turnId:'u',reason:'submitted'});expect(await panel.locator('article').count()).toBe(0);expect(await panel.textContent()).toContain('chưa phải xác nhận Native');
  await project(page,request());expect(await panel.locator('article').count()).toBe(0);expect(await page.evaluate(()=>window.PWNED)).toBeUndefined();
 }finally{await page.close();}
},45000);
it('keeps uncertain responses disabled, clears scopes and ignores late callbacks after dispose',async()=>{
 const {page,panel}=await open('reject');try{
  await project(page,request(1));await panel.getByRole('button',{name:'Không cho phép',exact:true}).click();
  await expect.poll(()=>panel.textContent()).toContain('Chưa rõ lựa chọn');expect(await panel.locator('button:enabled').count()).toBe(0);expect(await panel.textContent()).not.toContain('PRIVATE_ERROR_CANARY');
  await project(page,{type:'resolved',id:1,threadId:'t',turnId:'u',reason:'response_unknown'});expect(await panel.locator('article').count()).toBe(0);
  await project(page,request('1'));await panel.getByRole('button',{name:'Hủy',exact:true}).click();expect(await page.evaluate(()=>window.__calls)).toEqual([{id:1,decision:'decline'},{id:'1',decision:'cancel'}]);
  await page.evaluate(()=>window.__panel.clear());await project(page,request('1'));expect(await panel.locator('article').count()).toBe(0);
  await page.evaluate(()=>window.__panel.dispose());await project(page,request('new'));expect(await panel.count()).toBe(0);
 }finally{await page.close();}
},45000);
it('requires correlated complete file changes and projects lifecycle apart from assistant text',async()=>{
 const {page,panel}=await open();try{
  const approval=request('file','item/fileChange/requestApproval',{});await project(page,approval);expect(await panel.getByRole('button',{name:'Cho phép lần này'}).isDisabled()).toBe(true);
  const event={type:'tool',phase:'started',threadId:'t',turnId:'u',item:{id:'i',type:'fileChange',status:'inProgress',changes:[{path:'src/a.ts',kind:{type:'update',move_path:null},diff:'+<svg onload="window.PWNED=1">'}]}};
  await project(page,{...event,threadId:'foreign'});expect(await panel.getByRole('button',{name:'Cho phép lần này'}).isDisabled()).toBe(true);
  await project(page,event);expect(await panel.getByRole('button',{name:'Cho phép lần này'}).isEnabled()).toBe(true);expect(await panel.locator('pre').allTextContents()).toContain(event.item.changes[0].diff);expect(await panel.locator('svg').count()).toBe(0);
  await project(page,{...event,phase:'completed',item:{...event.item,status:'failed',truncated:true}});expect(await panel.getByRole('button',{name:'Cho phép lần này'}).isDisabled()).toBe(true);
  expect(await panel.textContent()).toContain('failed');expect(await page.locator('.fisch-conversation ol li').count()).toBe(0);
 }finally{await page.close();}
},45000);
it('sends supported nonsecret options/free answers without default selections',async()=>{
 const {page,panel}=await open();try{
  await project(page,{...request(7,'item/tool/requestUserInput',{questions:[{id:'choice',header:'Cách chơi',question:'Chọn cách',options:[{label:'A',description:'Mô tả'}],isOther:true},{id:'free',header:'Gợi ý',question:'Bạn muốn gì?'}]}),choices:[]});
  const submit=panel.getByRole('button',{name:'Gửi câu trả lời',exact:true});expect(await submit.isDisabled()).toBe(true);
  await panel.getByRole('radio',{name:'A Mô tả'}).check();await panel.getByRole('textbox',{name:'Trả lời Gợi ý'}).fill('Một câu công khai');await submit.click();
  expect(await page.evaluate(()=>window.__calls)).toEqual([{id:7,answers:JSON.parse('{"choice":{"answers":["A"]},"free":{"answers":["Một câu công khai"]}}')}]);expect(await submit.isDisabled()).toBe(true);
 }finally{await page.close();}
},45000);
it('bounds lifecycle history and keeps the page/composer reachable in narrow and wide layouts',async()=>{
 const {page,panel}=await open();try{
  await project(page,request('layout',undefined,{command:'x'.repeat(6000),cwd:'/public/'+ 'long/'.repeat(100)}));
  for(let i=0;i<35;i++)await project(page,{type:'tool',phase:'completed',threadId:'t',turnId:'u',item:{id:'tool'+i,type:'mcpToolCall',tool:'example',status:'completed'}});
  expect(await panel.locator('article').count()).toBe(25);
  for(const [width,height]of[[1440,900],[1280,720],[390,844],[320,568],[844,390]]){
   await page.setViewportSize({width,height});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
   const composer=page.locator('.fisch-conversation textarea');expect(await composer.evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight)).toBe(true);
   await panel.locator('summary').click();await panel.locator('summary').click();expect(await panel.evaluate(n=>n.getBoundingClientRect().width<=innerWidth)).toBe(true);
  }
  expect(await page.evaluate(()=>window.__mediaCalls)).toBe(0);
 }finally{await page.close();}
},45000);
