import {it,expect} from 'vitest';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
it('wires scoped visual admission without altering canonical chat and expires without further publication',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();let browser;
 try {
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+'live.html');await page.waitForFunction(()=>window.fischLive?.chatSceneContext());
  const setup=await page.evaluate(()=>{
   const api=window.fischLive;api.conversationDocument='doc';
   window.publicText='Here is the original Codex answer, unchanged.';
   window.dto={generation:1,revision:1,ownerTurn:'turn',available:true,canSend:true,canCancel:true,pending:false,stopping:false,waiting:false,error:'',messages:[
    {id:'u',turn:'turn',role:'user',text:'Explain it',status:'completed',truncated:false},
    {id:'a',turn:'turn',role:'assistant',text:window.publicText,status:'streaming',truncated:false}]};
   window.identity={documentId:'doc',threadId:'thread',turnId:'turn',generation:1,messageId:'a',textPrefix:window.publicText,publicRevision:1,section:0,remainingTtlMs:1200};
   api.conversationStatus(window.dto);const noMetadata=api.presentationSnapshot(window.identity);
   api.conversationStatus({...window.dto,threadId:'thread'});
   window.visualBody={type:'assemble',durationMs:80,parts:[{id:'visual',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]}]};
   window.shot=api.presentationSnapshot(window.identity);
   window.receipt=api.applyPresentation({scope:window.shot.scope,body:window.visualBody,annotations:{labels:[{text:'Visual only',x:.5,y:.2}],arrows:[]}});
   return {noMetadata,receipt:window.receipt,disabled:api.applyDiagramPresentation({}),original:JSON.stringify(window.dto)};
  });
  expect(setup.noMetadata).toBeNull();expect(setup.receipt.status).toBe('accepted');expect(setup.disabled.code).toBe('diagram_lab_disabled');
  expect(await page.locator('.fisch-conversation').textContent()).toContain('Here is the original Codex answer, unchanged.');
  await page.waitForFunction(()=>!window.fischLive.chatSceneContext()?.partIds.includes('visual')&&window.fischLive.chatSceneContext());
  expect(await page.locator('svg[aria-label="Scene annotations"] tspan').count()).toBe(0);
  expect(await page.evaluate(()=>JSON.stringify(window.dto))).toBe(setup.original);
  expect(await page.evaluate(()=>window.fischLive.applyPresentation({scope:window.receipt.scope,body:window.visualBody}).status)).toBe('rejected');
  // Scope invalidation must leave native publication intact and cannot replay old visuals.
  for(const action of ['user','clear','thread','hidden']){
   await page.waitForFunction(()=>window.fischLive.chatSceneContext());
   const outcome=await page.evaluate(action=>{
    const api=window.fischLive;api.conversationStatus({...window.dto,threadId:'thread'});
    const shot=api.presentationSnapshot({...window.identity,remainingTtlMs:5000});
    if(action==='user')api.reactiveUserIntent();
    if(action==='clear')api.conversationClear();
    if(action==='thread')api.conversationStatus({...window.dto,threadId:'other'});
    if(action==='hidden')document.dispatchEvent(new Event('visibilitychange'));
    return api.applyPresentation({scope:shot.scope,body:window.visualBody}).status;
   },action);expect(outcome).toBe('rejected');
  }
  await page.locator('#stop-all').click();expect(await page.locator('svg[aria-label="Scene annotations"]').count()).toBe(0);
  expect(await page.evaluate(()=>window.fischLive.presentationSnapshot(window.identity))).toBeNull();expect(errors).toEqual([]);
 }finally{await browser?.close();await server.close();}
},30000);
