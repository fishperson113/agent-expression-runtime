import { validCameraJpeg } from '../integrations/chat-camera-image.mjs';
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

const image = () => ({schemaVersion:1,url:'data:image/jpeg;base64,' + Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]).toString('base64'),width:1,height:1,capturedAt:1000,readAt:1100,mediaTime:1});
const frame = () => ({image:image(),source:{sessionId:'camera-a',revision:1}});
it('captures actual JPEG separately from bounded context and never substitutes geometry',async()=>{
 const channel={token:'doc-a'},broker={page:{evaluate:async()=>frame()}};
 const result=await captureChatObservation(broker,channel,scope);
 expect(result.image).toEqual({type:'image',url:image().url});expect(result.text).not.toContain('base64');
 expect(result.sourceFence).toEqual({documentToken:'doc-a',sessionId:'camera-a',revision:1});
 expect(result.validForMs).toBeGreaterThan(0);expect(result.validForMs).toBeLessThanOrEqual(1000);
 expect(await captureChatObservation({page:{evaluate:async()=>chatObservation(sample(),'epoch-a',1100)}},channel,scope)).toBeNull();
});
it.each(['off','invalid','oversize','dimensions','stale','future','source','throw'])('omits %s camera context without blocking text',async mode=>{
 const value=frame();if(mode==='invalid')value.image.url='data:image/jpeg;base64,AAAA';
 if(mode==='oversize')value.image.url='data:image/jpeg;base64,'+'A'.repeat(270000);
 if(mode==='dimensions')value.image.width=2;if(mode==='stale')value.image.readAt=2600;
 if(mode==='future')value.image.capturedAt=1200;if(mode==='source')value.source.revision=-1;
 const broker={page:{evaluate:async()=>{if(mode==='throw')throw Error('private');return mode==='off'?null:value;}}};
 expect(await captureChatObservation(broker,{token:'doc-a'},scope)).toBeNull();
});
it('bounds concurrent reads and rejects changed documents after capture',async()=>{
 let finish,calls=0;const channel={token:'doc-a'},broker={page:{evaluate:()=>{calls++;return new Promise(resolve=>finish=resolve);}}};
 const first=captureChatObservation(broker,channel,scope);expect(await captureChatObservation(broker,channel,scope)).toBeNull();expect(calls).toBe(1);
 channel.token='doc-b';finish(frame());expect(await first).toBeNull();
});
it('checks the real browser API, off and synthetic geometry do not produce camera images',async()=>{
 const {createServer}=await import('vite'),{chromium}=await import('@playwright/test');
 const server=await createServer({server:{host:'127.0.0.1',port:0}});let browser;
 try{await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=()=>{throw Error('no actual camera allowed');};});
 await page.goto(server.resolvedUrls.local[0]+'live.html?fixture=synthetic');await page.waitForFunction(()=>!!window.fischLive?.chatObservation);
 await page.evaluate(()=>{window.fischLive.conversationDocument='doc-a';window.fischLive.fixture('present-smile');});
 expect(await captureChatObservation({page},{token:'doc-a'},scope)).toBeNull();
 }finally{await browser?.close();await server.close();}
},45000);

it.each(['matching','stopped','restart','document'])('strips revoked image at actual broker barrier: %s',async mode=>{
 const {LiveReactiveBroker}=await import('../integrations/live-reactive-broker.mjs');
 const held=Promise.withResolvers(),entered=Promise.withResolvers();let conversation,guard,resolve,submitted;
 const source={documentToken:'doc-a',sessionId:'camera-a',revision:1},output={thread:'thread-a'};
 const broker=new LiveReactiveBroker({output,page:{evaluate:async()=>{entered.resolve();await held.promise;return source;}},
 beforeForward:(message,current)=>conversation.fenceObservation(message.id,current),
 forward:message=>{expect(guard(message)).toBe(true);submitted=message.params;resolve({result:{turn:{id:'turn-a',status:'inProgress'}}});},
 reject:()=>{throw Error('unexpected rejection');}});
 const transport={interruptUser:async()=>{},submitUser:(params,g)=>new Promise(done=>{
 guard=g;resolve=done;const message={id:'owned-send',method:'turn/start',params};expect(guard(message)).toBe(true);broker.client(message);
 })};
 conversation=new LiveConversation({output,broker,transport,captureObservation:()=>({text:'Camera metadata',image:{type:'image',url:image().url},validForMs:1000,sourceFence:{...source}})});
 const sending=conversation.send({generation:conversation.snapshot().generation,text:'  alo  '});await entered.promise;
 if(mode==='stopped')source.revision++;if(mode==='restart')source.sessionId='camera-b';if(mode==='document')source.documentToken='doc-b';
 held.resolve();await sending;expect(submitted.input[0].text).toBe('  alo  ');
 expect(submitted.input).toHaveLength(mode==='matching'?3:1);
 conversation.close();broker.close();
});

it('fails closed for truncated JPEG marker streams without throwing',()=>{
 for(const values of [[255,216,...Array(20).fill(255),217],[255,216,255,224,255,255,...Array(10).fill(255),217]]) {
  const url='data:image/jpeg;base64,'+Buffer.from(values).toString('base64');
  expect(()=>validCameraJpeg(url)).not.toThrow();expect(validCameraJpeg(url)).toBe(false);
 }
});
