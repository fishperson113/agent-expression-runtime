import {runInNewContext} from 'node:vm';
import {it,expect} from 'vitest';
import {LiveStreamingPresentationBridge,presentationSection} from '../integrations/presentation-streaming-bridge.mjs';
const tick=()=>new Promise(r=>setTimeout(r,5));
function fixture(){
 let now=1000, releases=[],calls=[],events=[];
 const snapshot={available:true,generation:1,revision:1,ownerTurn:'t',messages:[{id:'u',turn:'t',role:'user',status:'completed',text:'giai thich di'}, {id:'a',turn:'t',role:'assistant',status:'streaming',text:'',truncated:false}]};
 const state={channel:{token:'d'},output:{thread:'h'},conversation:{snapshot:()=>snapshot}};
 const page={evaluate:async(fn,arg)=>{calls.push({fn:String(fn),arg});if(arg?.identity)return {scope:{epoch:'e',sceneRevision:1},partIds:[]};if(arg?.body)return {status:'accepted'};}};
 const provider={generate:async(ex,signal,scene,stream)=>{calls.push({ex,signal,stream});await new Promise(r=>releases.push(r));},close(){}};
 const bridge=new LiveStreamingPresentationBridge({state,page,provider,now:()=>now,onEvent:e=>events.push(e),checkpoints:{minChars:10,cooldownMs:0}});
 const send=(method,extra={})=>bridge.observe({method,params:{threadId:'h',turnId:'t',...extra}});
 send('item/started',{item:{id:'a',type:'agentMessage',phase:'final_answer'}});
 return {bridge,calls,events,snapshot,send,releases,advance:(ms=100)=>now+=ms,append:text=>{snapshot.messages[1].text+=text;snapshot.revision++;send('item/agentMessage/delta',{itemId:'a',delta:text});}};
}
it('starts from a public final-answer checkpoint before MAIN completion, no private fields',async()=>{
 const f=fixture();f.append('Day la cau giai thich thu nhat. ');await tick();
 const call=f.calls.find(c=>c.ex);expect(call.ex.assistantText).toContain('thu nhat');expect(f.snapshot.ownerTurn).toBe('t');
 const identity=f.calls.find(c=>c.arg?.identity).arg.identity;
 expect(identity.sourceQuote).toBe(call.ex.target);expect(identity.textPrefix.slice(identity.sourceStart,identity.sourceEnd)).toBe(call.ex.target);
 expect(call.ex).not.toHaveProperty('privateReasoning');expect(f.calls.find(c=>c.arg?.identity).arg.identity.messageId).toBe('a');expect(f.calls.find(c=>c.arg?.identity).arg.identity.section).toBe(0);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});
it('supersedes immediately while inference is busy, one flight plus latest pending',async()=>{
 const f=fixture();f.append('Day la cau giai thich thu nhat. ');await tick();const first=f.calls.find(c=>c.ex);
 f.advance();f.append('\n\n**Chu de moi**\n\nDay la chu de thu hai rat khac. ');await tick();expect(first.signal.aborted).toBe(true);
 expect(f.calls.filter(c=>c.ex)).toHaveLength(1);expect(first.stream.isCurrent()).toBe(false);
 f.releases.shift()();await tick();expect(f.calls.filter(c=>c.ex)).toHaveLength(2);
 expect(f.calls.filter(c=>c.ex).at(-1).ex.target).not.toContain('thu nhat');
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});
it('identical replay does not regenerate and corrections revoke',async()=>{
 const f=fixture();f.append('Day la cau giai thich thu nhat. ');await tick();f.send('item/agentMessage/delta');await tick();expect(f.calls.filter(c=>c.ex)).toHaveLength(1);
 f.snapshot.messages[1].text='Noi dung da sua.';f.send('item/agentMessage/delta');await tick();expect(f.calls.find(c=>c.ex).signal.aborted).toBe(true);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});
it('commentary and unknown provenance never become source',async()=>{
 const f=fixture();f.bridge.invalidate();f.send('item/started',{item:{id:'a',type:'agentMessage',phase:'commentary'}});f.append('Day la commentary khong phai final. ');await tick();expect(f.calls.some(c=>c.ex)).toBe(false);f.bridge.close();
});

it('flushes a completed semantic tail after cooldown without refreshing publication time',async()=>{
 const f=fixture();f.bridge.checkpoints.config.cooldownMs=20;
 f.append('Day la cau giai thich thu nhat. ');await tick();f.releases.shift()();await tick();
 f.snapshot.messages[1].text+='Day la doan ket luan cuoi cung.';f.snapshot.messages[1].status='completed';f.snapshot.ownerTurn=null;
 f.send('item/completed',{item:{id:'a',type:'agentMessage',phase:'final_answer'}});
 expect(f.events.filter(e=>e.type==='checkpoint')).toHaveLength(1);
 f.advance();await new Promise(r=>setTimeout(r,35));
 expect(f.events.filter(e=>e.type==='checkpoint')).toHaveLength(2);
 expect(f.events.filter(e=>e.type==='checkpoint')[1].publishedAt).toBe(1000);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});

it('coalesces compatible same-section text instead of starving the active author',async()=>{
 const f=fixture();f.append('Day la cau giai thich thu nhat. ');await tick();const first=f.calls.find(c=>c.ex);
 f.advance();f.append('Day la vi du tiep theo trong cung phan. ');await tick();expect(first.signal.aborted).toBe(false);expect(first.stream.isCurrent()).toBe(true);
 expect(f.calls.filter(c=>c.ex)).toHaveLength(1);f.releases.shift()();await tick();expect(f.calls.filter(c=>c.ex)).toHaveLength(2);
 expect(f.calls.filter(c=>c.ex).at(-1).ex.target).toContain('thu nhat');
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});
it('section anchor ignores fenced headings, recognizes standalone bold titles',()=>{
 expect(presentationSection('intro\n```md\n# not a topic\n```')).toBe(0);
 expect(presentationSection('intro\n**New section**\ntext')).toBe(6);
});

it('never treats an unfinished streamed bold span as a section',()=>{
 expect(presentationSection('intro\n**inline bold**')).toBe(0);
 expect(presentationSection('intro\n**inline bold** continues prose.')).toBe(0);
 expect(presentationSection('intro\n**Real heading**\n')).toBe(6);
});

it('does not refresh the section source expiry when same-section text grows',async()=>{
 const f=fixture();f.append('Day la cau giai thich thu nhat. ');await tick();const first=f.calls.find(c=>c.ex);
 f.advance(9000);f.append('Van trong cung mot phan giai thich. ');await tick();expect(first.stream.isCurrent()).toBe(true);
 f.advance(1001);expect(first.stream.isCurrent()).toBe(false);
 f.releases.shift()();await tick();expect(f.calls.filter(c=>c.ex)).toHaveLength(1);f.bridge.close();
});

it('keeps an admitted scene lease through compatible appends rather than revoking it for pending text',async()=>{
 const f=fixture();f.append('Day la cau giai thich thu nhat. ');await tick();
 const call=f.calls.find(c=>c.ex);f.advance();f.append('Day la vi du cung phan. ');await tick();
 call.stream.onRecord({mode:'compose',payload:{base:'none',parts:[{id:'role',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]}]}});await tick();
 expect(f.events.some(e=>e.type==='admitted')).toBe(true);const revokes=f.events.filter(e=>e.type==='source_revoked').length;
 f.releases.shift()();await tick();f.advance();f.append('Them mot cau trong cung phan. ');await tick();
 expect(f.calls.filter(c=>c.ex)).toHaveLength(1);expect(f.events.filter(e=>e.type==='source_revoked')).toHaveLength(revokes);
 f.append('\n**Chu de moi**\nNoi dung chu de tiep theo. ');await tick();expect(f.events.some(e=>e.type==='source_revoked'&&e.reason==='section_changed')).toBe(true);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});

it('does not count a receipt arriving after source invalidation as current acceptance',async()=>{
 const f=fixture();f.append('Day la cau giai thich thu nhat. ');await tick();
 const evaluate=f.bridge.page.evaluate;f.bridge.page.evaluate=async(fn,arg)=>{if(arg?.body){f.append('\n**Chu de moi**\nNoi dung moi da den. ');return {status:'accepted'};}return evaluate(fn,arg);};
 f.calls.find(c=>c.ex).stream.onRecord({mode:'compose',payload:{base:'none',parts:[{id:'role',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]}]}});await tick();
 expect(f.events.some(e=>e.type==='admitted')).toBe(false);expect(f.events.some(e=>e.type==='admitted_stale')).toBe(true);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});

it('routes optional lab diagrams separately without altering native text',async()=>{
 const f=fixture();f.append('Day la cau giai thich thu nhat. ');await tick();const native=f.snapshot.messages[1].text;
 const diagram={plan:{caption:{text:'thu nhat'}},nodeParts:{},edgeParts:{}};
 f.calls.find(c=>c.ex).stream.onRecord({mode:'compose',payload:{base:'none',parts:[{id:'role',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]}]},diagram});await tick();
 const applied=f.calls.find(c=>c.arg?.body);expect(applied.arg.diagram).toEqual(diagram);expect(applied.fn).toContain('applyDiagramPresentation');expect(f.snapshot.messages[1].text).toBe(native);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});


it('opt-in bounded lease survives appended headings but not rewrites or expiry',async()=>{
 const f=fixture();f.bridge.boundedSourceLease=true;
 f.append('Day la cau giai thich thu nhat. ');await tick();const first=f.calls.find(c=>c.ex);
 f.advance();f.append('\n**Chu de moi**\nDay la chu de thu hai. ');await tick();
 expect(first.signal.aborted).toBe(false);expect(first.stream.isCurrent()).toBe(true);expect(f.calls.filter(c=>c.ex)).toHaveLength(1);
 f.advance(9901);expect(first.stream.isCurrent()).toBe(false);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});
it('opt-in bounded lease coalesces latest pending and retains original TTL after admission',async()=>{
 const f=fixture();f.bridge.boundedSourceLease=true;
 f.append('Day la cau giai thich thu nhat. ');await tick();const first=f.calls.find(c=>c.ex);
 f.advance();f.append('\n**Chu de moi**\nDay la chu de thu hai. ');await tick();
 first.stream.onRecord({mode:'compose',payload:{base:'none',parts:[{id:'role',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]}]}});await tick();
 const expiry=f.bridge.selected.expiresAt;f.releases.shift()();await tick();expect(f.calls.filter(c=>c.ex)).toHaveLength(1);
 f.advance(2501);f.bridge.drain();await tick();expect(f.calls.filter(c=>c.ex)).toHaveLength(2);expect(expiry).toBe(11000);
 f.snapshot.messages[1].text='replacement';f.send('item/agentMessage/delta');await tick();expect(f.calls.filter(c=>c.ex).at(-1).signal.aborted).toBe(true);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});

it('opt-in exact excerpts use first completed source time and exact author target',async()=>{
 const f=fixture();f.bridge.exactExcerptLease=true;f.bridge.boundedSourceLease=true;
 f.append('**A section**\n');f.advance(9000);
 const quote='A data pipeline can load one source with a small script when its volume and recovery needs remain simple.';
 f.append(quote+'\n\n');await tick();const call=f.calls.find(c=>c.ex);
 expect(call.ex.target).toBe(quote);expect(call.ex.publicContext).toBe('**A section**\n'+quote);expect(f.snapshot.messages[1].text).toBe('**A section**\n'+quote+'\n\n');expect(f.bridge.selected.sourceAt).toBe(10000);expect(f.bridge.selected.expiresAt).toBe(20000);
 expect(f.events.find(e=>e.type==='checkpoint').sourceAt).toBe(10000);
 const identity=f.calls.find(c=>c.arg?.identity).arg.identity;
 expect(identity).toMatchObject({sourceStart:'**A section**\n'.length,sourceEnd:('**A section**\n'+quote).length,sourceQuote:quote});
 expect(identity.textPrefix.slice(identity.sourceStart,identity.sourceEnd)).toBe(call.ex.target);
 f.advance(1000);f.append('Correction: the previous explanation needs a different qualification.');await tick();expect(call.signal.aborted).toBe(true);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});

const composed={mode:'compose',payload:{base:'none',parts:[{id:'role',kind:'ellipsoid',center:[0,0,0],scale:[.2,.2,.2]}]}};
it('bounds a hanging admission, never replays it, and records late acceptance only as stale',async()=>{
 const f=fixture();f.bridge.browserTimeoutMs=20;let complete,applies=0;const old=f.bridge.page.evaluate;
 f.bridge.page.evaluate=(fn,arg)=>{if(arg?.body){applies++;return new Promise(r=>complete=r);}return old(fn,arg);};
 f.bridge.provider.generate=async(ex,signal,scene,stream)=>stream.onRecord(composed);
 f.append('Day la cau giai thich thu nhat. ');await new Promise(r=>setTimeout(r,70));
 expect(f.bridge.active).toBeNull();expect(f.bridge.browserFault).toBe(true);expect(f.events.some(e=>e.type==='admission_unknown')).toBe(true);
 complete({status:'accepted'});await tick();expect(f.events.some(e=>e.type==='admitted_stale')).toBe(true);expect(f.events.some(e=>e.type==='admitted')).toBe(false);
 f.advance();f.append('\n**Other heading**\nAnother complete explanation. ');await tick();expect(applies).toBe(1);f.bridge.close();
});
it.each(['revoke','snapshot'])('bounds a hanging browser %s before any model request',async mode=>{
 const f=fixture();f.bridge.browserTimeoutMs=15;const old=f.bridge.page.evaluate;
 f.bridge.page.evaluate=(fn,arg)=>mode==='revoke'&&!arg||mode==='snapshot'&&arg?.identity?new Promise(()=>{}):old(fn,arg);
 f.append('Day la cau giai thich thu nhat. ');await new Promise(r=>setTimeout(r,50));
 expect(f.bridge.browserFault).toBe(true);expect(f.calls.some(c=>c.ex)).toBe(false);const count=f.calls.length;f.append(' More completed public prose. ');await tick();expect(f.calls).toHaveLength(count);f.bridge.close();
});
it('contains synchronous provider throws and releases its slot',async()=>{
 const f=fixture();f.bridge.provider.generate=()=>{throw Error('fixture_sync_failure');};
 f.append('Day la cau giai thich thu nhat. ');await tick();await tick();expect(f.bridge.active).toBeNull();expect(f.events.some(e=>e.type==='drop'&&e.code==='fixture_sync_failure')).toBe(true);f.bridge.close();
});
it('fails closed when wall clock rolls back between observations',async()=>{
 const f=fixture();f.append('Day la cau giai thich thu nhat. ');await tick();f.advance(-1);
 expect(f.calls.find(c=>c.ex).stream.isCurrent()).toBe(false);expect(f.bridge.browserFault).toBe(true);f.bridge.close();f.releases.forEach(r=>r());await tick();
});
it('telemetry anchors an exact excerpt before a newer heading to its real source offsets',async()=>{
 const f=fixture();f.bridge.exactExcerptLease=true;f.bridge.boundedSourceLease=true;
 const quote='A data pipeline can load one source with a small script when its volume and recovery needs remain simple.';
 f.append(quote+'\n\n**Later heading**\n');await tick();const event=f.events.find(e=>e.type==='checkpoint');expect(event.sourceStart).toBe(0);expect(event.sourceEnd).toBe(quote.length);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});

it.each(['close','invalidate','expiry'])('releases a hanging admission on %s without extending source lifetime',async action=>{
 const f=fixture();f.bridge.browserTimeoutMs=1000;if(action==='expiry')f.bridge.ttlMs=25;const old=f.bridge.page.evaluate;
 f.bridge.page.evaluate=(fn,arg)=>arg?.body?new Promise(()=>{}):old(fn,arg);
 f.bridge.provider.generate=async(ex,signal,scene,stream)=>stream.onRecord(composed);
 f.append('Day la cau giai thich thu nhat. ');await tick();
 if(action==='close')f.bridge.close();if(action==='invalidate')f.bridge.invalidate();
 await new Promise(r=>setTimeout(r,60));expect(f.bridge.active).toBeNull();expect(f.events.some(e=>e.type==='admission_unknown')).toBe(true);
 expect(f.events.some(e=>e.type==='admitted')).toBe(false);if(action==='expiry')expect(f.events.some(e=>e.type==='source_expired')).toBe(true);f.bridge.close();
});

it('browser snapshot rejects delayed expiry and clock rollback, never enlarges remaining lifetime',async()=>{
 const f=fixture();f.append('Day la cau giai thich thu nhat. ');await tick();const call=f.calls.find(c=>c.arg?.identity);
 const invoke=(wall,mono)=>runInNewContext('('+call.fn+')(value)',{value:{...call.arg,sentWall:1000,expiresAt:2000,monotonicDeadline:2000,remainingMs:1000},Date:{now:()=>wall},performance:{timeOrigin:0,now:()=>mono},window:{fischLive:{presentationSnapshot:value=>value}}});
 expect(invoke(900,1100)).toBeNull();expect(invoke(1500,2100)).toBeNull();expect(invoke(1500,1700).remainingTtlMs).toBe(300);
 f.bridge.close();f.releases.forEach(r=>r());await tick();
});
