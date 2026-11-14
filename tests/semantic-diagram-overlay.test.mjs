import {beforeAll,afterAll,it,expect} from 'vitest';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
let server,browser;
beforeAll(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});},45000);
afterAll(async()=>{await browser?.close();await server?.close();});
it('anchors literal labels to displayed groups and refuses stale/missing/overflow scenes',async()=>{
 const page=await browser.newPage({viewport:{width:1000,height:800}});await page.goto(server.resolvedUrls.local[0]);
 await page.evaluate(`(async()=>{
  const {SemanticDiagramOverlay}=await import('/src/live/semantic-diagram-overlay.ts');
  document.body.replaceChildren();const host=document.createElement('div');host.id='fixture';host.style='position:relative;width:900px;height:600px';document.body.append(host);
  window.layer=new SemanticDiagramOverlay(host);window.plan={nodes:[{id:'a',term:'<b>source</b>'}],edges:[],caption:{text:'A source can need processing, not always.'}};
  window.bindings={nodeParts:{a:['a1']},edgeParts:{}};window.frame={contentFrame:1,capturedAt:Date.now(),parts:[{id:'a1',bounds:{min:{x:.2,y:.2},max:{x:.4,y:.4}}}]};
  window.paint=(current=true)=>window.layer.draw(window.plan,window.bindings,window.frame,current);
 })()`);
 expect(await page.evaluate(()=>window.paint())).toBe(true);expect(await page.locator('#fixture b').count()).toBe(0);
 expect(await page.locator('[data-semantic-diagram] div').first().textContent()).toBe('<b>source</b>');
 const first=await page.locator('[data-semantic-diagram] div').first().boundingBox();
 await page.evaluate(()=>{window.frame.capturedAt=Date.now();window.frame.parts[0].bounds={min:{x:.5,y:.2},max:{x:.7,y:.4}};window.paint();});
 const moved=await page.locator('[data-semantic-diagram] div').first().boundingBox();expect(moved.x-first.x).toBeCloseTo(270,0);
 expect(await page.evaluate(()=>window.paint(false))).toBe(false);expect(await page.locator('[data-semantic-diagram] div').count()).toBe(0);
 expect(await page.evaluate(()=>{window.frame.capturedAt=Date.now()-501;return window.paint();})).toBe(false);
 expect(await page.evaluate(()=>{window.frame.capturedAt=Date.now();window.frame.parts=[];return window.paint();})).toBe(false);
 expect(await page.evaluate(()=>{document.querySelector('#fixture').style.width='300px';return window.paint();})).toBe(false);
 await page.evaluate(()=>window.layer.dispose());await page.close();
},30000);

it('keeps a qualified relation label clear of anchored role text without rewriting the source',async()=>{
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
 const result=await page.evaluate(`(async()=>{
  const {SemanticDiagramOverlay}=await import('/src/live/semantic-diagram-overlay.ts');document.body.replaceChildren();
  const host=document.createElement('div');host.style='position:relative;width:900px;height:600px';document.body.append(host);
  const layer=new SemanticDiagramOverlay(host),quote='A source can need processing; simple work can use a script.';
  const plan={nodes:[{id:'a',term:'A source'},{id:'b',term:'processing'}],edges:[{id:'e',from:'a',to:'b',predicate:'can need'}],caption:{text:quote}};
  const part=(id,x1,x2)=>({id,bounds:{min:{x:x1,y:.28},max:{x:x2,y:.39}}});
  const bindings={nodeParts:{a:['a'],b:['b']},edgeParts:{e:['e']}};
  const frame={contentFrame:1,capturedAt:Date.now(),parts:[part('a',.33,.48),part('b',.52,.67),part('e',.48,.52)]};
  const visible=layer.draw(plan,bindings,frame,true),text=host.textContent;
  host.style.width='650px';host.style.height='460px';frame.capturedAt=Date.now();const resized=layer.draw(plan,bindings,frame,true);layer.dispose();return {visible,resized,text,quote};
 })()`);expect(result.visible).toBe(true);expect(result.resized).toBe(true);expect(result.text).toContain('can need');expect(result.text).toContain(result.quote);await page.close();
},30000);


it('fits a mixed horizontal and vertical topology without overlapping fixed-width labels',async()=>{
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
 const result=await page.evaluate(`(async()=>{
  const {SemanticDiagramOverlay}=await import('/src/live/semantic-diagram-overlay.ts');document.body.replaceChildren();
  const host=document.createElement('div');host.style='position:relative;width:900px;height:600px';document.body.append(host);
  const layer=new SemanticDiagramOverlay(host),quote='Profiling checks types and relations.';
  const plan={nodes:[{id:'a',term:'Profiling'},{id:'b',term:'types'},{id:'c',term:'relations'}],edges:[{id:'e',from:'a',to:'b',predicate:'checks'},{id:'v',from:'a',to:'c',predicate:'checks'}],caption:{text:quote}};
  const part=(id,x1,y1,x2,y2)=>({id,bounds:{min:{x:x1,y:y1},max:{x:x2,y:y2}}});
  const bindings={nodeParts:{a:['a'],b:['b'],c:['c']},edgeParts:{e:['e'],v:['v']}};
  const frame={contentFrame:1,capturedAt:Date.now(),parts:[part('a',.3,.2,.45,.3),part('b',.55,.2,.7,.3),part('c',.3,.55,.45,.65),part('e',.45,.25,.55,.25),part('v',.375,.3,.375,.55)]};
  const visible=layer.draw(plan,bindings,frame,true);host.style.width='650px';host.style.height='460px';frame.capturedAt=Date.now();const resized=layer.draw(plan,bindings,frame,true);layer.dispose();return {visible,resized};
 })()`);expect(result.visible).toBe(true);expect(result.resized).toBe(true);await page.close();
},30000);

it('fits tall wrapped node names beside vertical relation labels at actual compact projection',async()=>{
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
 const result=await page.evaluate(`(async()=>{
 const {SemanticDiagramOverlay}=await import('/src/live/semantic-diagram-overlay.ts');document.body.replaceChildren();
 const host=document.createElement('div');host.style='position:relative;width:650px;height:460px';document.body.append(host);const layer=new SemanticDiagramOverlay(host);
 const plan={nodes:[{id:'a',term:'Data Platform Engineer'},{id:'b',term:'operating costs'}],edges:[{id:'e',from:'a',to:'b',predicate:'manages'}],caption:{text:'Data Platform Engineer manages operating costs.'}};
 const part=(id,x1,y1,x2,y2)=>({id,bounds:{min:{x:x1,y:y1},max:{x:x2,y:y2}}});
 const frame={contentFrame:1,capturedAt:Date.now(),parts:[part('a',.326,.29,.477,.38),part('b',.326,.47,.477,.56),part('e',.4,.38,.4,.47)]};
 const visible=layer.draw(plan,{nodeParts:{a:['a'],b:['b']},edgeParts:{e:['e']}},frame,true);return {visible,fit:layer.lastFit};
 })()`);expect(result.visible).toBe(true);expect(result.fit.collisions).toEqual([]);await page.close();
},30000);
