import {it,expect} from 'vitest';
import {LiveStreamingPresentationBridge} from '../integrations/presentation-streaming-bridge.mjs';
const tick=()=>new Promise(r=>setTimeout(r,10));
const a='The little fish noticed a closed gate in the aquarium and paused to inspect the unfamiliar object before moving closer.';
const b='The small fish tried a different route around the stones, keeping a cautious distance from the gate while looking for its friend.';
function fixture(){
 let now=1000,ticket=0;const calls=[],browser=[],events=[];
 const answer={id:'a',turn:'t',role:'assistant',status:'streaming',text:'',truncated:false};
 const snapshot={available:true,generation:1,revision:1,ownerTurn:'t',messages:[{id:'u',turn:'t',role:'user',status:'completed',text:'Tell a story.'},answer]};
 const state={channel:{token:'d'},output:{thread:'h'},conversation:{snapshot:()=>snapshot}};
 const page={evaluate:async(fn,arg)=>{browser.push({fn:String(fn),arg});if(String(fn).includes('presentationPreparationTicket'))return {intentVersion:0,preparationVersion:++ticket};if(arg?.identity)return {scope:{epoch:'e',sceneRevision:1},partIds:[]};if(arg?.body)return {status:'accepted',epoch:'e',sceneRevision:2,seq:3};}};
 const provider={generate:async(ex,signal,scene,callbacks)=>{calls.push({ex,signal,callbacks});await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});},close(){}};
 const bridge=new LiveStreamingPresentationBridge({state,page,provider,paragraphSources:true,now:()=>now,onEvent:e=>events.push(e)});
 const send=(method,extra={})=>bridge.observe({method,params:{threadId:'h',turnId:'t',...extra}});
 send('item/started',{item:{type:'agentMessage',phase:'final_answer',id:'a'}});
 return {bridge,calls,browser,events,snapshot,answer,append(text,at){now=at;answer.text+=text;snapshot.revision++;send('item/agentMessage/delta');},replace(text,at){now=at;answer.text=text;snapshot.revision++;send('item/agentMessage/delta');}};
}
it('assigns genuinely new closed paragraphs their own source deadline without renewing the first one',async()=>{
 const f=fixture();try{
 f.append(a+'\n\n',1000);await tick();expect(f.calls).toHaveLength(1);
 expect(f.browser.find(x=>x.arg?.identity).arg.expiresAt).toBe(11000);
 f.append(b+'\n\n',13000);await tick();await tick();expect(f.calls).toHaveLength(2);
 expect(f.calls[0].signal.aborted).toBe(true);expect(f.calls[1].ex.target).toBe(b);
 const prepared=f.browser.filter(x=>x.arg?.identity).at(-1).arg;expect(prepared.expiresAt).toBe(23000);
 expect(prepared.identity.sourceStart).toBe(a.length+2);expect(prepared.identity.sourceQuote).toBe(b);
 f.append(a+'\n\n',14000);await tick();expect(f.calls).toHaveLength(2);
 expect(f.events.filter(x=>x.type==='checkpoint').map(x=>x.sourceAt)).toEqual([1000,13000]);
 }finally{f.bridge.close();await tick();}
});
it('passes complete available prior qualifiers and suffix without truncating or inserting them in native chat',async()=>{
 const f=fixture();try{
 const qualifier='This is a fictional possibility, not a claim that the gate has opened.';
 f.snapshot.messages.unshift({id:'prior',turn:'old',role:'assistant',status:'completed',text:qualifier});
 f.append(a+'\n\nBut this remains uncertain',1000);await tick();expect(f.calls).toHaveLength(1);
 expect(f.calls[0].ex.publicContext).toContain(qualifier);expect(f.calls[0].ex.publicContext).toContain('But this remains uncertain');
 expect(f.calls[0].ex.target).toBe(a);expect(f.answer.text).toBe(a+'\n\nBut this remains uncertain');
 }finally{f.bridge.close();await tick();}
});
it('abstains instead of silently dropping an over-capacity prior qualifier',async()=>{
 const f=fixture();try{f.snapshot.messages.unshift({id:'prior',turn:'old',role:'assistant',status:'completed',text:'Do not infer success. '+ 'x'.repeat(4096)});f.append(a+'\n\n',1000);await tick();expect(f.calls).toHaveLength(0);}finally{f.bridge.close();}
});
it('revokes a corrected paragraph and rejects its late complete record without changing newer geometry',async()=>{
 const f=fixture();try{
 f.append(a+'\n\n',1000);await tick();const old=f.calls[0];f.replace('Correction: '+b+'\n\n',1500);await tick();expect(old.signal.aborted).toBe(true);
 old.callbacks.onRecord({mode:'compose',payload:{base:'none',parts:[{id:'late',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]}]}});await tick();
 expect(f.browser.some(x=>x.arg?.body)).toBe(false);expect(f.events.some(x=>x.type==='admitted')).toBe(false);
 }finally{f.bridge.close();await tick();}
});

it('revokes an active candidate when an ordinary appended qualifier exceeds full context capacity',async()=>{
 const f=fixture();try{
 f.append(a+'\n\n',1000);await tick();const old=f.calls[0];
 f.append('But only if the gate remains closed. '+ 'x'.repeat(4096),1500);await tick();
 expect(old.signal.aborted).toBe(true);expect(f.calls).toHaveLength(1);
 expect(f.events.some(x=>x.type==='source_revoked'&&x.reason==='context_limit')).toBe(true);
 }finally{f.bridge.close();await tick();}
});
it('documents the opt-in limitation: a later ordinary qualifier does not renew or cancel the captured source',async()=>{
 const f=fixture();try{
 f.append(a+'\n\n',1000);await tick();const old=f.calls[0];
 f.append('But only if the gate has not opened',1500);await tick();
 expect(old.signal.aborted).toBe(false);expect(f.calls).toHaveLength(1);
 expect(old.ex.publicContext).toBe(a+'\n\n');
 expect(f.browser.filter(x=>x.arg?.identity).at(-1).arg.expiresAt).toBe(11000);
 f.append('\n\nCorrection: the earlier description is no longer valid.',1600);await tick();
 expect(old.signal.aborted).toBe(true);
 }finally{f.bridge.close();await tick();}
});

it('keeps paragraph sampling off by default and rejects incompatible options', () => {
 const provider={close(){}};
 const ordinary=new LiveStreamingPresentationBridge({state:{},page:{},provider});
 expect(ordinary.paragraphs).toBeNull();expect(ordinary.exactExcerptLease).toBe(false);
 expect(()=>new LiveStreamingPresentationBridge({state:{},page:{},provider,paragraphSources:'1'})).toThrow('presentation_paragraph_protocol');
 expect(()=>new LiveStreamingPresentationBridge({state:{},page:{},provider,paragraphSources:true,protocol:'diagram'})).toThrow('presentation_paragraph_protocol');
});
