const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const keyOf=(doc,s,u)=>JSON.stringify([doc,s.threadId,s.generation,u.turn,u.id]);
const history=messages=>JSON.stringify(messages.map(m=>({id:m.id,turn:m.turn,role:m.role,text:m.text,status:m.status,truncated:m.truncated===true})));
const validSnapshot=(doc,s)=>s&&id(doc)&&id(s.threadId)&&Number.isSafeInteger(s.generation)&&s.generation>=0&&
 Number.isSafeInteger(s.revision)&&s.revision>=0&&['available','pending','stopping'].every(k=>typeof s[k]==='boolean')&&
 (s.ownerTurn===null||id(s.ownerTurn))&&Object.hasOwn(s,'error')&&Array.isArray(s.messages)&&
 s.messages.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string');
// Independent user-request authority, not a claim about the assistant's answer.
// First observed acceptance starts the clock; assistant growth never renews it.
export class UserRequestLeaseV2 {
 constructor(now=()=>performance.now()){this.now=now;this.enabled=false;this.configured=false;this.seen=new Set();this.serial=0;this.current=null;this.expiredDeference=null;}
 enable(doc,snapshot){if(this.configured)return false;this.configured=true;this.enabled=true;this.observe(doc,snapshot);return true;}
 retire(){this.current=null;this.expiredDeference=null;this.evidence=[];}
 tombstone(version){const source=this.current??this.expiredDeference;if(!source||source.sourceVersion!==version)return false;this.retire();return true;}
 deferenceSource(doc,s){this.observe(doc,s);return s?.pending?null:this.expiredDeference;}
 boundary(doc,s){
  const epoch=JSON.stringify([doc,s.threadId,s.generation]);if(this.epoch===epoch)return false;
  this.retire();this.epoch=epoch;this.lastRevision=s.revision;
  for(const u of s.messages.filter(m=>m.role==='user'))this.seen.add(keyOf(doc,s,u));
  if(this.seen.size>64)this.enabled=false;return true;
 }
 observe(doc,s){
  if(!this.enabled)return null;const now=this.now();
  if(!Number.isFinite(now)||this.lastNow!==undefined&&now<this.lastNow){this.retire();this.enabled=false;return null;}this.lastNow=now;
  if(!validSnapshot(doc,s)||!s.available){this.retire();this.epoch=null;return null;}
  if(this.boundary(doc,s))return null;
  if(s.revision<this.lastRevision){this.retire();this.enabled=false;return null;}this.lastRevision=s.revision;
  const index=s.messages.findLastIndex(m=>m.role==='user'),u=s.messages[index];if(!u){this.retire();return null;}
  const key=keyOf(doc,s,u);if(this.seen.size>=64&&!this.seen.has(key)){this.retire();this.enabled=false;return null;}
  if((this.current??this.expiredDeference)?.key!==key)this.retire();
  const after=s.messages.slice(index+1),before=s.messages.slice(0,index);
  const completed=after.length>0&&after.every(m=>m.role==='assistant'&&m.turn===u.turn&&m.status==='completed');
  const bad=s.stopping||s.error||!(s.ownerTurn===u.turn||s.ownerTurn===null&&completed)||!id(u.id)||!id(u.turn)||u.truncated||
   !['streaming','completed'].includes(u.status)||!u.text.trim()||u.text.length>2048||s.messages.some(m=>m.truncated)||
   after.some(m=>m.role!=='assistant'||m.turn!==u.turn||!id(m.id)||!['streaming','completed'].includes(m.status));
  if(bad){this.seen.add(key);this.retire();return null;}
  const prior=history(before),context=[...before,u].filter(m=>m.text.length).map(m=>`[${m.role}] ${m.text}`).join('\n\n');
  const lineage=this.current??this.expiredDeference;
  if(lineage&&(lineage.text!==u.text||prior!==this.historicalPrefix)){this.retire();return null;}
  if(lineage&&this.evidence.some((m,i)=>!after[i]||after[i].id!==m.id||!after[i].text.startsWith(m.text)||m.status==='completed'&&after[i].status!=='completed')){this.retire();return null;}
  if(this.current&&now>=this.current.deadline){this.expiredDeference=this.current;this.current=null;}
  if(!this.current&&!this.expiredDeference){
   if(this.seen.has(key))return null;this.seen.add(key);if(context.length>4096)return null;
   this.historicalPrefix=prior;
   this.current=Object.freeze({key,documentId:doc,threadId:s.threadId,generation:s.generation,turnId:u.turn,messageId:u.id,text:u.text,publicContext:context,
    sourceVersion:++this.serial,sourceAt:now,deadline:now+10000,publicRevision:s.revision});
  }
  this.evidence=after.map(m=>({id:m.id,text:m.text,status:m.status}));
  return s.pending?null:this.current;
 }
}
