import {it,expect} from 'vitest';
import {UserRequestAdmissionV2} from '../src/live/user-request-admission-v2';
function setup(admitted=true){let now=100,seq=0,owned:any=null,mode='accepted',retireThrows=false;const retired:any[]=[];
 const s:any={documentId:'d',stopped:false,hidden:false,scene:{epoch:'e',revision:1,partIds:[]},snapshot:{threadId:'t',generation:1,revision:0,available:true,pending:false,stopping:false,error:null,ownerTurn:null,messages:[]}};
 const exact=(r:any)=>{if(retireThrows)throw Error('retirement_failed');retired.push({...r});if(owned&&['epoch','sceneRevision','seq'].every(k=>owned[k]===r[k])){owned=null;s.scene={...s.scene,revision:s.scene.revision+1};}};
 const p=new UserRequestAdmissionV2(()=>s,(_body,_scope,valid)=>{if(!valid())return {status:'rejected'};if(mode==='throw')throw Error('unknown_apply');if(mode==='rejected')return {status:'rejected'};s.scene={...s.scene,revision:s.scene.revision+1};owned={status:'accepted',epoch:'e',sceneRevision:s.scene.revision,seq:++seq};if(mode.startsWith('missing_')){const result={...owned};delete result[mode.slice(8)];return result;}return owned;},()=>now,()=>{if(owned)exact(owned);},true,exact);
 p.configureUserRequestPreviewV2();s.snapshot.ownerTurn='turn';s.snapshot.revision++;s.snapshot.messages.push({id:'u',turn:'turn',role:'user',status:'completed',text:'Make a synthetic shape.'});
 const identity:any={documentId:'d',threadId:'t',generation:1,turnId:'turn',messageId:'u',sourceRole:'user_request',textPrefix:s.snapshot.messages[0].text,publicRevision:1,section:0,sourceStart:0,sourceEnd:s.snapshot.messages[0].text.length,sourceQuote:s.snapshot.messages[0].text,remainingTtlMs:10000};identity.sourceVersion=p.userRequestSourceV2(identity)!.sourceVersion;
 const userShot=p.prepare(identity,p.preparationTicket())!;if(admitted)p.applyPrepared({scope:userShot.scope,body:{}});
 const capture=p.captureUserRequestV2()!;s.snapshot.messages.push({id:'a',turn:'turn',role:'assistant',status:'streaming',text:'The synthetic result follows the request.'});s.snapshot.revision++;
 const assistant:any={...identity,sourceRole:'assistant',sourceVersion:undefined,messageId:'a',textPrefix:s.snapshot.messages[1].text,sourceQuote:s.snapshot.messages[1].text,sourceEnd:s.snapshot.messages[1].text.length,publicRevision:2};
 return {p,s,identity,userShot,capture,assistant,retired,get owned(){return owned;},setMode:(m:string)=>mode=m,setRetireThrows:()=>retireThrows=true,advance:(n:number)=>now+=n,call:(retain=false)=>{const shot=p.prepare(assistant,p.preparationTicket());return p.handoffUserRequestV2({capture,scope:shot?.scope,body:{},retain});}};
}
it('accepted handoff preserves anchor/intent and permanently fences late user',()=>{const f=setup(),intent=f.p.preparationTicket().intentVersion;const result=f.call();expect(result.status).toBe('accepted');expect(f.p.preparationTicket().intentVersion).toBe(intent);expect(f.retired).toEqual([]);expect(f.p.userRequestSourceV2(f.identity)).toBeNull();expect(f.p.applyPrepared({scope:f.userShot.scope,body:{}}).status).toBe('rejected');expect(f.owned.sceneRevision).toBe(result.sceneRevision);});
it('retain tombstones and exact retires without generic intent invalidation',()=>{const f=setup(),intent=f.p.preparationTicket().intentVersion;expect(f.call(true).status).toBe('retained');expect(f.retired).toEqual([f.capture.receipt]);expect(f.owned).toBeNull();expect(f.p.preparationTicket().intentVersion).toBe(intent);});
it('rejected handoff leaves no user orphan',()=>{const f=setup();f.setMode('rejected');expect(f.call().status).toBe('rejected');expect(f.owned).toBeNull();expect(f.p.userRequestSourceV2(f.identity)).toBeNull();});
it('wrong receipt cannot tombstone authority or clear geometry',()=>{const f=setup();if(!f.capture.receipt)throw Error('fixture_requires_owned_receipt');f.capture.receipt.seq++;expect(f.call().status).toBe('rejected');expect(f.retired).toEqual([]);expect(f.p.userRequestSourceV2(f.identity)).not.toBeNull();});
it('unadmitted user authority is fenced before a late prepared user apply',()=>{const f=setup(false);expect(f.capture.receipt).toBeNull();expect(f.call(true).status).toBe('retained');expect(f.p.userRequestSourceV2(f.identity)).toBeNull();expect(f.p.applyPrepared({scope:f.userShot.scope,body:{}}).status).toBe('rejected');expect(f.retired).toEqual([]);});
it('unknown apply is not relabelled rejected and old cleanup cannot clear newer owner',()=>{const f=setup();f.setMode('throw');expect(()=>f.call()).toThrow('presentation_handoff_unknown');const g=setup();const accepted=g.call();expect(g.call(true).status).toBe('rejected');expect(g.owned.sceneRevision).toBe(accepted.sceneRevision);});
it('expired user or cancelled turn cannot authorize handoff',()=>{const f=setup();f.advance(10000);expect(f.call().status).toBe('rejected');const g=setup();g.s.snapshot.stopping=true;expect(g.call().status).toBe('rejected');});

it.each(['sceneRevision','epoch','seq'])('accepted malformed %s after mutation is unknown, never a clean rejection',(field)=>{const f=setup(),before=f.s.scene.revision;f.setMode('missing_'+field);expect(()=>f.call()).toThrow('presentation_handoff_unknown');expect(f.s.scene.revision).toBeGreaterThan(before);expect(f.p.userRequestSourceV2(f.identity)).toBeNull();expect(f.p.applyPrepared({scope:f.userShot.scope,body:{}}).status).toBe('rejected');});
it('retirement failure surfaces while tombstone stays permanent and later owner survives',()=>{const f=setup();f.setRetireThrows();expect(()=>f.call(true)).toThrow('retirement_failed');expect(f.p.userRequestSourceV2(f.identity)).toBeNull();expect(f.p.applyPrepared({scope:f.userShot.scope,body:{}}).status).toBe('rejected');const next=f.p.prepare(f.assistant,f.p.preparationTicket())!;const accepted=f.p.applyPrepared({scope:next.scope,body:{}});expect(accepted.status).toBe('accepted');expect(f.call(true).status).toBe('rejected');expect(f.owned.sceneRevision).toBe(accepted.sceneRevision);});

it('proof: expired never-admitted capture permits the independently valid prepared assistant',()=>{
 const f=setup(false),witness=setup(false);expect(f.capture.receipt).toBeNull();expect(f.owned).toBeNull();
 const prepare=(x:ReturnType<typeof setup>)=>{x.advance(9000);const shot=x.p.prepare(x.assistant,x.p.preparationTicket())!;expect(shot).not.toBeNull();x.advance(1100);return shot;};
 const shot=prepare(f),ordinary=prepare(witness),scope={...shot.scope},intent=f.p.preparationTicket().intentVersion;
 expect(f.p.userRequestSourceV2(f.identity)).toBeNull();
 expect(witness.p.applyPrepared({scope:ordinary.scope,body:{}}).status).toBe('accepted');
 expect(f.p.handoffUserRequestV2({capture:f.capture,scope:shot.scope,body:{}}).status).toBe('accepted');
 expect(f.retired).toEqual([]);expect(shot.scope).toEqual(scope);expect(f.p.preparationTicket().intentVersion).toBe(intent);
 expect(f.p.userRequestSourceV2(f.identity)).toBeNull();
 expect(f.p.applyPrepared({scope:f.userShot.scope,body:{}}).status).toBe('rejected');
 expect(f.p.handoffUserRequestV2({capture:f.capture,scope:shot.scope,body:{}}).status).toBe('rejected');
});
it.each(['owned','new_version','manual_intent','assistant_expiry','anchor_change'])('proof control: %s cannot authorize expired-capture handoff',(control)=>{
 const f=setup(control==='owned');f.advance(9000);
 const shot=f.p.prepare(f.assistant,f.p.preparationTicket())!;expect(shot).not.toBeNull();
 f.advance(control==='assistant_expiry'?10000:1100);
 if(control==='new_version'){
  f.s.snapshot.ownerTurn='next';f.s.snapshot.revision++;
  f.s.snapshot.messages.push({id:'u2',turn:'next',role:'user',status:'completed',text:'Make another synthetic shape.'});
  f.p.userRequestSourceV2({...f.identity,turnId:'next',messageId:'u2',sourceQuote:'Make another synthetic shape.'});
 }
 if(control==='manual_intent')f.p.invalidate();
 if(control==='anchor_change')f.s.scene={...f.s.scene,revision:f.s.scene.revision+1};
 const before=f.s.scene.revision,owner=f.owned&&{...f.owned},retired=f.retired.length;
 expect(f.p.handoffUserRequestV2({capture:f.capture,scope:shot.scope,body:{}}).status).toBe('rejected');
 expect(f.s.scene.revision).toBe(before);expect(f.owned).toEqual(owner);expect(f.retired).toHaveLength(retired);
});

it('expiry then rewrite and reversion cannot recover deference lineage',()=>{
 const f=setup(false);f.advance(9000);const shot=f.p.prepare(f.assistant,f.p.preparationTicket())!;f.advance(1100);
 expect(f.p.userRequestSourceV2(f.identity)).toBeNull();
 const original=f.s.snapshot.messages[0].text;f.s.snapshot.messages[0].text='Changed user request.';f.s.snapshot.revision++;
 expect(f.p.userRequestSourceV2(f.identity)).toBeNull();
 f.s.snapshot.messages[0].text=original;f.s.snapshot.revision++;
 expect(f.p.handoffUserRequestV2({capture:f.capture,scope:shot.scope,body:{}}).status).toBe('rejected');expect(f.owned).toBeNull();
});
it('expired ever-admitted version cannot bypass ownership with a cleared receipt',()=>{
 const f=setup();f.advance(9000);const shot=f.p.prepare(f.assistant,f.p.preparationTicket())!;
 // Deliberately simulate receipt bookkeeping loss, not an authorized retirement.
 (f.p as any).userOwned=undefined;(f.p as any).issued=undefined;
 f.advance(1100);const before=f.s.scene.revision;
 expect(f.p.handoffUserRequestV2({capture:{sourceVersion:f.capture.sourceVersion,receipt:null},scope:shot.scope,body:{}}).status).toBe('rejected');
 expect(f.s.scene.revision).toBe(before);expect(f.retired).toEqual([]);
});
