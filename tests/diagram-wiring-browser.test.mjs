import {it,expect} from 'vitest';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {parseDiagramAuthorRecord} from '../integrations/diagram-author.mjs';
import {composeExpression} from '../integrations/compose-expression.mjs';
it('shows an exact-source diagram on actual frames and revokes without changing native text',async()=>{
 const quote='Queues buffer work.';
 const record=parseDiagramAuthorRecord(JSON.stringify({mode:'diagram',unitId:'u0',nodes:[{id:'q',term:'Queues',slot:0},{id:'w',term:'work',slot:1}],edges:[{id:'e',from:'q',to:'w',predicate:'buffer',direction:'none'}]}),{target:quote});
 const body=composeExpression(record.payload).body;
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1800,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+'live.html?diagramLab=1');await page.waitForFunction(()=>window.fischLive?.chatSceneContext());
  const result=await page.evaluate(({quote,body,diagram})=>{
   const api=window.fischLive;api.conversationDocument='doc';window.diagramBody=body;window.diagram=diagram;
   const prefix='Earlier sentence. '+quote;window.dto={threadId:'thread',generation:1,revision:1,ownerTurn:'turn',available:true,canSend:true,canCancel:true,pending:false,stopping:false,waiting:false,error:'',messages:[{id:'u',turn:'turn',role:'user',text:'Explain queues',status:'completed',truncated:false},{id:'a',turn:'turn',role:'assistant',text:prefix,status:'streaming',truncated:false}]};
   api.conversationStatus(window.dto);window.identity={documentId:'doc',threadId:'thread',turnId:'turn',generation:1,messageId:'a',textPrefix:prefix,publicRevision:1,section:0,remainingTtlMs:6000,sourceStart:'Earlier sentence. '.length,sourceEnd:prefix.length,sourceQuote:quote};
   const {sourceStart,sourceEnd,sourceQuote,...legacy}=window.identity;
   const missing=api.applyDiagramPresentation({scope:api.presentationSnapshot(legacy).scope,body,diagram});
   window.shot=api.presentationSnapshot(window.identity);
   const wrong=structuredClone(diagram);wrong.plan.caption.text='Earlier sentence.';
   const bad=api.applyDiagramPresentation({scope:window.shot.scope,body,diagram:wrong});
   window.receipt=api.applyDiagramPresentation({scope:window.shot.scope,body,diagram});return {missing,bad,receipt:window.receipt};
  },{quote,body,diagram:record.diagram});
  expect(result.missing.status).toBe('rejected');expect(result.bad.status).toBe('rejected');expect(result.receipt.status).toBe('accepted');
  await page.waitForFunction(()=>window.fischLive.diagramLabStatus().visible,{},{timeout:5000});
  const status=await page.evaluate(()=>window.fischLive.diagramLabStatus());expect(status.frameId).toBeGreaterThan(0);expect(status.fit.collisions).toEqual([]);
  expect(await page.locator('[data-semantic-diagram]').textContent()).toContain(quote);
  expect(await page.locator('.fisch-conversation').textContent()).toContain('Earlier sentence. '+quote);
  const first=await page.evaluate(()=>{const rect=document.querySelector('[data-semantic-diagram] div')?.getBoundingClientRect();return rect?{x:rect.x,y:rect.y}:null;});
  await page.waitForTimeout(200);const second=await page.evaluate(()=>{const rect=document.querySelector('[data-semantic-diagram] div')?.getBoundingClientRect();return rect?{x:rect.x,y:rect.y}:null;});
  expect(second,JSON.stringify(await page.evaluate(()=>window.fischLive.diagramLabStatus()))).not.toBeNull();
  expect(Math.abs(first.x-second.x)).toBeLessThan(15);expect(Math.abs(first.y-second.y)).toBeLessThan(15);
  // Canvas offset must never silently detach labels from the submitted particles.
  await page.locator('#body').evaluate(el=>el.style.left='12px');
  await page.waitForFunction(()=>window.fischLive.diagramLabStatus().reason==='diagram_viewport_mismatch');
  expect(await page.locator('[data-semantic-diagram] div').count()).toBe(0);await page.locator('#body').evaluate(el=>el.style.left='');
  await page.waitForFunction(()=>window.fischLive.chatSceneContext());
  await page.evaluate(()=>{const api=window.fischLive;const scope=api.presentationSnapshot({...window.identity,remainingTtlMs:1200}).scope;api.applyDiagramPresentation({scope,body:window.diagramBody,diagram:window.diagram});});
  await page.waitForFunction(()=>window.fischLive.diagramLabStatus().visible);
  await page.waitForFunction(()=>!window.fischLive.diagramLabStatus().visible&&window.fischLive.chatSceneContext());
  expect(await page.locator('[data-semantic-diagram] div').count()).toBe(0);
  await page.locator('#stop-all').click();expect(await page.locator('[data-semantic-diagram]').count()).toBe(0);expect(errors).toEqual([]);
 }finally{await browser?.close();await server.close();}
},30000);
