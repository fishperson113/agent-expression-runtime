import { beforeAll, afterAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { parsePanelControl } from '../src/live/panel-controls';
import { PanelProtocol } from '../integrations/panel-client.mjs';
const request = (id = 'r') => ({ type: 'request', id, method: 'item/commandExecution/requestApproval', threadId: 't', turnId: 'u', itemId: 'i', details: { command: 'echo public', cwd: '/public' }, choices: ['accept', 'decline', 'cancel'] });
it('preserves exact typed IDs and clones bounded request details', () => {
  const raw = request(1), parsed = parsePanelControl(raw);
  expect(parsed.id).toBe(1); expect(parsePanelControl(request('1')).id).toBe('1');
  raw.details.command = 'changed'; expect(parsed.details.command).toBe('echo public');
});
it('rejects getters, cycles, oversize data and session-wide approval choices', () => {
  let reads = 0; const getter = { ...request(), get details() { reads++; return {}; } };
  expect(parsePanelControl(getter)).toBeUndefined(); expect(reads).toBe(0);
  const cycle = request(); cycle.details.self = cycle;
  let shared = {}; for (let i = 0; i < 4; i++) shared = Array(512).fill(shared);
  expect(parsePanelControl(shared)).toBeUndefined();
  for (const raw of [cycle, { ...request(), details: { command: 'x'.repeat(17000) } }, { ...request(), id: Infinity },
    { ...request(), choices: ['acceptForSession'] }, { ...request(), choices: ['accept', 'accept'] }]) expect(parsePanelControl(raw)).toBeUndefined();
});
it('validates nonsecret question IDs and supported option metadata', () => {
  const raw = { ...request(2), method: 'item/tool/requestUserInput', details: { questions: [{ id: 'choice', header: 'Chọn', question: 'Cách nào?', options: [{ label: 'A', description: 'Một lựa chọn' }], isOther: true }] }, choices: [] };
  expect(parsePanelControl(raw).details.questions[0].id).toBe('choice');
  expect(parsePanelControl({ ...raw, details: { questions: [{ ...raw.details.questions[0], id: '__proto__' }] } })).toBeUndefined();
  expect(parsePanelControl({ ...raw, details: { questions: [{ ...raw.details.questions[0], isSecret: true }] } })).toBeUndefined();
  expect(parsePanelControl({ ...raw, details: { questions: [raw.details.questions[0], raw.details.questions[0]] } })).toBeUndefined();
});
it('accepts only canonical lifecycle event phases and resolution reasons', () => {
  const scope = { threadId: 't', turnId: 'u' };
  expect(parsePanelControl({ type: 'resolved', id: 'r', ...scope, reason: 'response_unknown' }).reason).toBe('response_unknown');
  expect(parsePanelControl({ type: 'resolved', id: 'r', ...scope, reason: 'approved' })).toBeUndefined();
  expect(parsePanelControl({ type: 'tool', phase: 'completed', ...scope, item: { id: 'i', type: 'mcpToolCall', status: 'failed' } }).item.status).toBe('failed');
  expect(parsePanelControl({ type: 'tool', phase: 'success', ...scope, item: { id: 'i', type: 'mcpToolCall' } })).toBeUndefined();
});
it('strictly decodes bounded file eligibility without accepting fields or broadened choices', () => {
  const event = { type: 'eligibility', id: 0, threadId: 't', turnId: 'u', itemId: 'i', choices: ['accept', 'decline', 'cancel'] };
  expect(parsePanelControl(event).id).toBe(0);
  for (const raw of [{ ...event, extra: true }, { ...event, itemId: '' }, { ...event, choices: ['acceptForSession'] }, { ...event, choices: [['decline'], ['cancel']] }, { ...event, choices: ['accept', 'accept'] }]) expect(parsePanelControl(raw)).toBeUndefined();
});

let server,browser;
const browserRequest=(id='r',method='item/commandExecution/requestApproval',details={command:'echo <img src=x onerror="window.PWNED=1">',cwd:'/public/project'})=>({type:'request',id,method,threadId:'t',turnId:'u',itemId:'i',details,choices:['accept','decline','cancel']});
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
it('links real protocol late file eligibility to an explicit one-time choice and revokes changed review', async () => {
 const events=[],writes=[],protocol=new PanelProtocol({write:value=>writes.push(value),onControl:value=>events.push(value)});
 protocol.threadId='t';protocol.receive({method:'turn/started',params:{threadId:'t',turn:{id:'u'}}});
 const {page,panel}=await open();const flush=async()=>{while(events.length)await project(page,events.shift());};
 const fileRequest=id=>({id,method:'item/fileChange/requestApproval',params:{threadId:'t',turnId:'u',itemId:'i',grantRoot:null,startedAtMs:0}});
 const tool=diff=>({method:'item/started',params:{threadId:'t',turnId:'u',item:{id:'i',type:'fileChange',status:'inProgress',changes:[{path:'src/public.ts',diff,kind:{type:'update',move_path:null}}]}}});
 try{
  await page.exposeFunction('__backendRespond',value=>protocol.respond(value));
  await page.evaluate(()=>{window.__panel.dispose();window.__panel=window.__mountPanelControls(document.querySelector('.fisch-conversation'),value=>window.__backendRespond(value));});
  protocol.receive(fileRequest('late'));await flush();expect(await panel.getByRole('button',{name:'Cho phép lần này',exact:true}).count()).toBe(0);expect(writes).toEqual([]);
  await project(page,{type:'eligibility',id:'late',threadId:'foreign',turnId:'u',itemId:'i',choices:['accept','decline','cancel']});
  expect(await panel.getByRole('button',{name:'Cho phép lần này',exact:true}).count()).toBe(0);
  protocol.receive(tool('+public'));await flush();expect(await panel.locator('pre').allTextContents()).toContain('+public');
  await panel.getByRole('button',{name:'Cho phép lần này',exact:true}).click();await flush();
  expect(writes).toEqual([{id:'late',result:{decision:'accept'}}]);
  protocol.receive(fileRequest('changed'));await flush();expect(await panel.getByRole('button',{name:'Cho phép lần này',exact:true}).isEnabled()).toBe(true);
  protocol.receive(tool('+different'));await flush();expect(await panel.getByRole('button',{name:'Cho phép lần này',exact:true}).count()).toBe(0);
  expect(()=>protocol.respond({id:'changed',decision:'accept'})).toThrow('invalid');expect(writes).toHaveLength(1);
  protocol.receive(tool('+public'));await flush();expect(await panel.getByRole('button',{name:'Cho phép lần này',exact:true}).count()).toBe(0);
  await project(page,{type:'request',id:'changed',method:'item/fileChange/requestApproval',threadId:'t',turnId:'u',itemId:'i',details:fileRequest('changed').params,choices:['accept','decline','cancel']});
  expect(await panel.getByRole('button',{name:'Không cho phép',exact:true}).isEnabled()).toBe(true);
 }finally{protocol.close();await page.close();}
},45000);
it('shows actual command/cwd safely and sends once without inventing Native acknowledgement',async()=>{
 const {page,panel}=await open();try{
  await project(page,browserRequest());expect(await panel.locator('pre').allTextContents()).toEqual([browserRequest().details.command,'/public/project']);expect(await panel.locator('img').count()).toBe(0);
  await panel.getByRole('button',{name:'Cho phép lần này',exact:true}).click();await panel.getByRole('button',{name:'Cho phép lần này',exact:true}).evaluate(b=>b.click());
  expect(await page.evaluate(()=>window.__calls)).toEqual([{id:'r',decision:'accept'}]);expect(await panel.locator('button:enabled').count()).toBe(0);
  await page.evaluate(()=>window.__settle[0]({status:'submitted'}));expect(await panel.locator('article').count()).toBe(1);
  await project(page,{type:'resolved',id:'r',threadId:'t',turnId:'u',reason:'submitted'});expect(await panel.locator('article').count()).toBe(0);expect(await panel.textContent()).toContain('chưa phải xác nhận Native');
  await project(page,browserRequest());expect(await panel.locator('article').count()).toBe(0);expect(await page.evaluate(()=>window.PWNED)).toBeUndefined();
 }finally{await page.close();}
},45000);
it('keeps uncertain responses disabled, clears scopes and ignores late callbacks after dispose',async()=>{
 const {page,panel}=await open('reject');try{
  await project(page,browserRequest(1));await panel.getByRole('button',{name:'Không cho phép',exact:true}).click();
  await expect.poll(()=>panel.textContent()).toContain('Chưa rõ lựa chọn');expect(await panel.locator('button:enabled').count()).toBe(0);expect(await panel.textContent()).not.toContain('PRIVATE_ERROR_CANARY');
  await project(page,{type:'resolved',id:1,threadId:'t',turnId:'u',reason:'response_unknown'});expect(await panel.locator('article').count()).toBe(0);
  await project(page,browserRequest('1'));await panel.getByRole('button',{name:'Hủy',exact:true}).click();expect(await page.evaluate(()=>window.__calls)).toEqual([{id:1,decision:'decline'},{id:'1',decision:'cancel'}]);
  await page.evaluate(()=>window.__panel.clear());await project(page,browserRequest('1'));expect(await panel.locator('article').count()).toBe(0);
  await page.evaluate(()=>window.__panel.dispose());await project(page,browserRequest('new'));expect(await panel.count()).toBe(0);
 }finally{await page.close();}
},45000);
it('requires correlated complete file changes and projects lifecycle apart from assistant text',async()=>{
 const {page,panel}=await open();try{
  const approval=browserRequest('file','item/fileChange/requestApproval',{});await project(page,approval);expect(await panel.getByRole('button',{name:'Cho phép lần này'}).isDisabled()).toBe(true);
  const event={type:'tool',phase:'started',threadId:'t',turnId:'u',item:{id:'i',type:'fileChange',status:'inProgress',changes:[{path:'src/a.ts',kind:{type:'update',move_path:null},diff:'+<svg onload="window.PWNED=1">'}]}};
  await project(page,{...event,threadId:'foreign'});expect(await panel.getByRole('button',{name:'Cho phép lần này'}).isDisabled()).toBe(true);
  await project(page,event);expect(await panel.getByRole('button',{name:'Cho phép lần này'}).isEnabled()).toBe(true);expect(await panel.locator('pre').allTextContents()).toContain(event.item.changes[0].diff);expect(await panel.locator('svg').count()).toBe(0);
  await project(page,{...event,phase:'completed',item:{...event.item,status:'failed',truncated:true}});expect(await panel.getByRole('button',{name:'Cho phép lần này'}).isDisabled()).toBe(true);
  expect(await panel.textContent()).toContain('failed');expect(await page.locator('.fisch-conversation ol li').count()).toBe(0);
 }finally{await page.close();}
},45000);
it('sends supported nonsecret options/free answers without default selections',async()=>{
 const {page,panel}=await open();try{
  await project(page,{...browserRequest(7,'item/tool/requestUserInput',{questions:[{id:'choice',header:'Cách chơi',question:'Chọn cách',options:[{label:'A',description:'Mô tả'}],isOther:true},{id:'free',header:'Gợi ý',question:'Bạn muốn gì?'}]}),choices:[]});
  const submit=panel.getByRole('button',{name:'Gửi câu trả lời',exact:true});expect(await submit.isDisabled()).toBe(true);
  await panel.getByRole('radio',{name:'A Mô tả'}).check();await panel.getByRole('textbox',{name:'Trả lời Gợi ý'}).fill('Một câu công khai');await submit.click();
  expect(await page.evaluate(()=>window.__calls)).toEqual([{id:7,answers:JSON.parse('{"choice":{"answers":["A"]},"free":{"answers":["Một câu công khai"]}}')}]);expect(await submit.isDisabled()).toBe(true);
 }finally{await page.close();}
},45000);
it('bounds lifecycle history and keeps the page/composer reachable in narrow and wide layouts',async()=>{
 const {page,panel}=await open();try{
  await project(page,browserRequest('layout',undefined,{command:'x'.repeat(6000),cwd:'/public/'+ 'long/'.repeat(100)}));
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
it('keeps the production composer clickable after tool history and approval resolution',async()=>{
 const page=await browser.newPage(),sent=[];try{
  await page.exposeFunction('fischLiveConversation',value=>{sent.push(value);return{status:'accepted'};});await page.goto(server.resolvedUrls.local[0]+'live.html?fixture=synthetic');await page.waitForFunction(()=>!!window.fischLive);
  await page.evaluate(()=>{window.fischLive.panelControlStatus({type:'mode'});window.fischLive.conversationStatus({generation:1,revision:1,ownerTurn:null,available:true,canSend:true,canCancel:false,pending:false,stopping:false,waiting:false,error:'',messages:[]});});
  for(let i=0;i<12;i++)await page.evaluate(i=>window.fischLive.panelControlStatus({type:'tool',phase:'completed',threadId:'t',turnId:'u',item:{id:'tool'+i,type:'mcpToolCall',tool:'observe',status:'completed'}}),i);
  await page.evaluate(value=>window.fischLive.panelControlStatus(value),browserRequest());await page.evaluate(()=>window.fischLive.panelControlStatus({type:'resolved',id:'r',threadId:'t',turnId:'u',reason:'submitted'}));
  const panel=page.locator('.fisch-panel-controls'),input=page.locator('.fisch-conversation textarea'),send=page.locator('.fisch-conversation button[type=submit]');
  for(const[width,height]of[[1280,800],[390,844],[844,390]]){await page.setViewportSize({width,height});if(!await panel.evaluate(n=>n.open))await panel.locator('summary').click();await input.fill('Public next message');expect(await panel.evaluate(n=>n.open)).toBe(false);await send.click({trial:true});}
  await send.click();expect(sent).toHaveLength(1);
 }finally{await page.close();}
},45000);

it('keeps sanitized startup failure visible with sending disabled in the production panel',async()=>{
 const page=await browser.newPage();try{
  await page.goto(server.resolvedUrls.local[0]+'live.html?fixture=synthetic');await page.waitForFunction(()=>!!window.fischLive);
  await page.evaluate(()=>{window.fischLive.panelControlStatus({type:'mode'});window.fischLive.conversationStatus({generation:1,revision:1,ownerTurn:null,available:false,canSend:false,canCancel:false,pending:false,stopping:false,waiting:false,error:'conversation_startup_failed',messages:[]});window.fischLive.panelControlStatus({type:'startup_failed',code:-32603});});
  expect(await page.locator('.conversation-status').textContent()).toContain('chưa thể khởi tạo');
  expect(await page.locator('.fisch-panel-controls').textContent()).toContain('RPC -32603');
  expect(await page.locator('.fisch-conversation button[type=submit]').isDisabled()).toBe(true);
  expect(parsePanelControl({type:'startup_failed',code:-32603,error:'PRIVATE'})).toBeUndefined();
 }finally{await page.close();}
},45000);
