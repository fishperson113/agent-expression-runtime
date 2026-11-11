import { it, expect } from 'vitest';
import { LiveConversation } from '../integrations/live-conversation.mjs';
import { chatObservation } from '../src/live/chat-observation';
import { unavailableUser } from '../src/core/live/types';
import { formatChatObservation, captureChatObservation, unavailableChatObservation } from '../integrations/chat-observation.mjs';
const sample = () => ({ v:1, sessionId:'camera-a', seq:2, capturedAt:1000, camera:'tracking', turn:'idle', summary:'PRIVATE_SUMMARY_DO_NOT_SEND', user:{...unavailableUser(),present:true,quality:{score:.8,basis:'tracking-stability'},position:{x:.2,y:.3},expression:{smile:.7,browRaise:.1,eyesClosed:0,mouthOpen:.2}} });
const scope = { submissionId:'submission-a',thread:'thread-a',generation:1,intent:2 };
it('freezes a bounded geometric reading without summaries, images or emotion claims',()=>{
 const original=sample(),dto=chatObservation(original,'epoch-a',1100),text=formatChatObservation(dto,scope);
 expect(dto).toMatchObject({state:'fresh',source:{sessionId:'camera-a',seq:2,epoch:'epoch-a',capturedAt:1000,readAt:1100,ageMs:100}});
 expect(text).toContain('NOT emotions');expect(text).toContain('"smile":0.7');expect(text).not.toContain('PRIVATE_SUMMARY');
 original.user.expression.smile=0;expect(JSON.parse(text.split('\n')[1]).geometry.expressionCoefficients.smile).toBe(.7);
});
it('reports stale, denied, stopped and absent distinctly with no stale geometry',()=>{
 for(const camera of ['denied','stopped','starting','error']){
  const dto=chatObservation({...sample(),camera},'epoch-a',1100);expect(dto).toMatchObject({state:'unavailable',source:{camera},geometry:null});expect(formatChatObservation(dto,scope)).not.toBe(unavailableChatObservation);
 }
 expect(chatObservation(sample(),'epoch-a',2600)).toMatchObject({state:'stale',geometry:null});
 expect(chatObservation({...sample(),camera:'absent',user:unavailableUser()},'epoch-a',1100)).toMatchObject({state:'fresh',geometry:{facePresent:false}});
 expect(chatObservation(sample(),'epoch-a',900)).toMatchObject({state:'stale',geometry:null});
});
it('rejects extra fields, raw media, inconsistent ages, invalid coefficients and oversized data',()=>{
 const dto=chatObservation(sample(),'epoch-a',1100);
 for(const invalid of [{...dto,rawFrame:'PRIVATE'}, {...dto,source:{...dto.source,ageMs:0}}, {...dto,geometry:{...dto.geometry,expressionCoefficients:{...dto.geometry.expressionCoefficients,smile:2}}}, {...dto,geometry:{...dto.geometry,summary:'instruction'}}]) expect(formatChatObservation(invalid,scope)).toBe(unavailableChatObservation);
});
it('checks the browser document token and never substitutes a later sample after capture',async()=>{
 const channel={token:'doc-a',stale:false},dto=chatObservation(sample(),'epoch-a',1100);
 const broker={page:{evaluate:async(fn,arg)=>{const old=globalThis.window;globalThis.window={fischLive:{conversationDocument:'doc-a',chatObservation:()=>dto}};try{return fn(arg);}finally{globalThis.window=old;}}}};
 expect((await captureChatObservation(broker,channel,scope)).text).toContain('camera-a');
 channel.token='doc-b';expect(await captureChatObservation(broker,channel,scope)).toBe(unavailableChatObservation);
 channel.stale=true;expect(await captureChatObservation(broker,channel,scope)).toBe(unavailableChatObservation);
 expect(await captureChatObservation({page:{evaluate:async()=>{throw Error('PRIVATE');}}},{token:'doc-a'},scope)).toBe(unavailableChatObservation);
});
it('reads production browser snapshots without media and keeps the earlier reading immutable',async()=>{
 const {createServer}=await import('vite'),{chromium}=await import('@playwright/test');
 const server=await createServer({server:{host:'127.0.0.1',port:0}});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.addInitScript(()=>{window.__mediaCalls=0;navigator.mediaDevices.getUserMedia=()=>{window.__mediaCalls++;throw Error('no media');};});
  await page.goto(server.resolvedUrls.local[0]+'live.html?fixture=synthetic');await page.waitForFunction(()=>!!window.fischLive?.chatObservation);
  const off=await page.evaluate(()=>window.fischLive.chatObservation());expect(off).toMatchObject({state:'unavailable',source:{camera:'stopped'},geometry:null});
  await page.evaluate(()=>window.fischLive.fixture('present-smile'));
  const first=await page.evaluate(()=>window.fischLive.chatObservation());expect(first.state).toBe('fresh');expect(formatChatObservation(first,scope)).toContain('expressionCoefficients');
  await page.evaluate(()=>{window.fischLive.conversationDocument='doc-a';});let submitted;
  const transport={interruptUser:async()=>{},submitUser:async(params,guard)=>{expect(guard({id:'owned-send',params})).toBe(true);submitted=params;return{result:{turn:{id:'turn-a',status:'inProgress'}}};}};
  const conversation=new LiveConversation({output:{thread:'thread-a'},broker:{busy:()=>false},transport,captureObservation:job=>captureChatObservation({page},{token:'doc-a',stale:false},job)});
  await conversation.send({generation:conversation.snapshot().generation,text:'Original public user text'});
  expect(submitted.threadId).toBe('thread-a');expect(submitted.input[0].text).toBe('Original public user text');expect(submitted.input[1].text).toContain('expressionCoefficients');conversation.close();
  await page.evaluate(()=>window.fischLive.fixture('denied'));const denied=await page.evaluate(()=>window.fischLive.chatObservation());
  expect(denied).toMatchObject({state:'unavailable',source:{camera:'denied'},geometry:null});expect(first.source.seq).toBeLessThan(denied.source.seq);expect(first.geometry.facePresent).toBe(true);
  expect(await page.evaluate(()=>window.__mediaCalls)).toBe(0);
 }finally{await browser?.close();await server.close();}
},45000);
it('bounds optional reads without consuming broker waiters or changing MAIN availability',async()=>{
 let finish,calls=0;const channel={token:'doc-a',stale:false};
 const broker={page:{evaluate:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}},closed:false,browserUnavailable:false};
 const first=captureChatObservation(broker,channel,scope);
 expect(await captureChatObservation(broker,channel,scope)).toBe(unavailableChatObservation);expect(calls).toBe(1);
 channel.token='doc-b';finish(chatObservation(sample(),'epoch-a',1100));expect(await first).toBe(unavailableChatObservation);
 expect(broker).toMatchObject({closed:false,browserUnavailable:false});
});
