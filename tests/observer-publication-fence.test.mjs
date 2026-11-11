import { it, expect } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';
import { bindLiveConversation } from '../integrations/live-conversation.mjs';

it('uses the real same-frame binding to deny queued revoked context before any caption or DSL reaches the sink',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});
  for(const outcome of ['failed-terminal','next-turn','closed','same']){
   const page=await browser.newPage();let current={revision:1,submissionId:'submission-a',threadId:'main-thread',turnId:'main-turn',text:'Public excerpt',ageMs:0},queries=0,nativeTurns=0;
   await page.goto(server.resolvedUrls.local[0]+'live.html?fixture=synthetic');await page.waitForFunction(()=>!!window.fischLive);
   await page.evaluate(()=>{window.__sink=[];window.fischLive.deliverNativeReaction=async(_id,data)=>{window.__sink.push(data);return{reason:data?'observed':'invalid_decision'};};});
   const queued=Promise.withResolvers(),release=Promise.withResolvers();
   const proxy={evaluate:async(fn,arg)=>{if(arg?.native && Object.hasOwn(arg,'data')){queued.resolve();await release.promise;}return page.evaluate(fn,arg);}};
   const broker=new LiveReactiveBroker({page:proxy,provider:{conversationLane:true},output:{},forward(){nativeTurns++;},reject(){},contextSource:()=>current});
   const unbind=await bindLiveConversation(page,{authorizeObserverContext:id=>{queries++;return broker.authorizeObserverContext(id);},navigation(){},send(){nativeTurns++;},cancel(){nativeTurns++;}});
   const deadline=await page.evaluate(()=>performance.now()+30000),owned={id:'request-a',request:{},controller:new AbortController(),terminal:false,hostCapabilities:{schemaVersion:1,expressionAllowed:false,currentTurnContext:current},contextDeadline:deadline};broker.active=owned;
   const pending=broker.finish(owned,{reply:'OLD CONTEXT',decision:{validUntil:deadline,mode:'observe'}});await queued.promise;
   if(outcome==='failed-terminal')current=null;if(outcome==='next-turn')current={...current,revision:2,submissionId:'submission-b'};if(outcome==='closed')broker.close();
   release.resolve();await pending;await expect.poll(()=>page.evaluate(()=>window.__sink.length)).toBe(1);
   const values=await page.evaluate(()=>window.__sink);expect(values[0]?.reply??null).toBe(outcome==='same'?'OLD CONTEXT':null);expect(queries).toBe(1);expect(nativeTurns).toBe(0);
   unbind();broker.close();await page.close();
  }
 }finally{await browser?.close();await server.close();}
},45000);
