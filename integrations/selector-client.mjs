import {fork as forkProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readSelectorBundle,selectorText,sourceHash,exactKeys,PROFILE,LABELS} from './selector-runtime.mjs';

function childEnvironment() {
 const names=['PATH','PATHEXT','SystemRoot','WINDIR','TEMP','TMP','LANG','LC_ALL','TZ'];
 return Object.fromEntries(names.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
}
function response(value) {
 if(!exactKeys(value,['probabilities','selected','tokens','sourceHash','timing']) ||
    !Array.isArray(value.probabilities)||value.probabilities.length!==3 ||
    value.probabilities.some(x=>!Number.isFinite(x)||x<0||x>1) ||
    !Array.isArray(value.selected)||value.selected.some(x=>!LABELS.includes(x)) ||
    new Set(value.selected).size!==value.selected.length || !Number.isInteger(value.tokens) ||
    value.tokens<2||value.tokens>128||typeof value.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(value.sourceHash) ||
    !exactKeys(value.timing,['tokenizeMs','inferenceAndHeadMs','totalMs']) ||
    Object.values(value.timing).some(x=>!Number.isFinite(x)||x<0)) throw Error('selector_protocol');
 const selected=LABELS.filter((_,i)=>value.probabilities[i]>=[.5,.6,.5][i]);
 if(JSON.stringify(selected)!==JSON.stringify(value.selected))throw Error('selector_protocol');
 return value;
}
export class SelectorClient {
 constructor(child,library,{startupMs=15000,requestMs=3000,closeMs=1000}={}) {
  if(![startupMs,requestMs,closeMs].every(x=>Number.isInteger(x)&&x>0&&x<=30000))throw Error('selector_timeout');
  Object.assign(this,{child,library,requestMs,closeMs,active:null,pending:null,closed:false,closing:false,started:false});
  this.ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
  void this.ready.catch(()=>{});
  this.exited=new Promise(resolve=>{this.exitResolve=resolve;});
  child.on('message',value=>{try{this.message(value);}catch{this.fail('selector_protocol');}});
  child.on('error',()=>this.fail('selector_process'));
  child.on('disconnect',()=>{if(!this.closing)this.fail('selector_disconnect');});
  child.on('exit',()=>{this.fail('selector_exit');this.exitResolve();});
  this.startupTimer=setTimeout(()=>this.fail('selector_startup_timeout'),startupMs);
 }
 send(value) {
  try {this.child.send(value,error=>{if(error)this.fail('selector_transport');});}
  catch {this.fail('selector_transport');}
 }
 settle(job,error,value) {
  if(!job)return;
  job.signal?.removeEventListener('abort',job.abort);
  if(!job.settled){job.settled=true;error?job.reject(Error(error)):job.resolve(value);}
  job.input=null;
 }
 fail(code) {
  if(this.closed)return;
  this.closed=true;clearTimeout(this.startupTimer);clearTimeout(this.active?.timer);
  this.readyReject(Error(code));this.settle(this.active,code);this.settle(this.pending,code);
  this.active=null;this.pending=null;
  try{this.child.kill('SIGKILL');}catch{}
 }
 message(value) {
  if(this.closed)return;
  if(exactKeys(value,['type','code'])&&value.type==='fatal'){this.fail('selector_worker');return;}
  if(!this.started){
   if(!exactKeys(value,['type','profile'])||value.type!=='ready'||value.profile!==PROFILE)throw Error('ready');
   this.started=true;clearTimeout(this.startupTimer);this.readyResolve(this);return;
  }
  if(exactKeys(value,['type'])&&value.type==='closed'){
   if(!this.closing||this.active)throw Error('closed');
   this.child.disconnect?.();return;
  }
  const job=this.active;
  if(!job||value?.id!==job.id)throw Error('response');
  if(value.type==='result'&&exactKeys(value,['type','id','result'])){
   const result=response(value.result);
   if(result.sourceHash!==job.hash)throw Error('hash');
   this.settle(job,job.cancelled?'selector_aborted':null,result);
  } else if(value.type==='cancelled'&&exactKeys(value,['type','id'])&&job.cancelled) {
   this.settle(job,'selector_aborted');
  } else if(value.type==='error'&&exactKeys(value,['type','id','code'])){
   const allowed=['selector_too_long','selector_input','selector_input_size','selector_inference'];
   if(!allowed.includes(value.code))throw Error('error');
   this.settle(job,value.code);
  } else throw Error('response');
  clearTimeout(job.timer);this.active=null;
  if(this.closing)this.send({type:'close'});else this.drain();
 }
 score(input,{signal}={}) {
  if(this.closed||this.closing)return Promise.reject(Error('selector_closed'));
  if(!this.started)return Promise.reject(Error('selector_not_ready'));
  if(signal?.aborted)return Promise.reject(Error('selector_aborted'));
  let hash;
  try{hash=sourceHash(selectorText(input));}catch{return Promise.reject(Error('selector_input'));}
  const copy={publicContext:input.publicContext,target:input.target};
  return new Promise((resolve,reject)=>{
   const job={id:randomUUID(),input:copy,hash,resolve,reject,signal,settled:false,cancelled:false};
   job.abort=()=>{
    job.cancelled=true;this.settle(job,'selector_aborted');
    if(this.pending===job)this.pending=null;
    if(this.active===job)this.send({type:'cancel',id:job.id});
   };
   signal?.addEventListener('abort',job.abort,{once:true});
   this.settle(this.pending,'selector_superseded');this.pending=job;
   if(signal?.aborted)job.abort();else this.drain();
  });
 }
 drain() {
  if(this.active||!this.pending||this.closed||this.closing)return;
  const job=this.active=this.pending;this.pending=null;
  job.timer=setTimeout(()=>this.fail('selector_request_timeout'),this.requestMs);
  const input=job.input;this.send({type:'score',id:job.id,input});job.input=null;
 }
 close() {
  if(this.closePromise)return this.closePromise;
  this.closing=true;clearTimeout(this.startupTimer);
  this.readyReject(Error('selector_closed'));this.settle(this.pending,'selector_closed');this.pending=null;
  if(this.active){this.active.cancelled=true;this.settle(this.active,'selector_closed');this.send({type:'cancel',id:this.active.id});}
  else if(!this.closed)this.send({type:'close'});
  this.closePromise=(async()=>{
   let timer;await Promise.race([this.exited,new Promise(resolve=>{timer=setTimeout(()=>{this.fail('selector_close_timeout');resolve();},this.closeMs);})]);
   clearTimeout(timer);
  })();
  return this.closePromise;
 }
}
export async function bootstrapSelector(manifestPath,{runtimeDirectory=fileURLToPath(new URL('./selector/',import.meta.url)),
 fork=forkProcess,signal}={}) {
 let client;
 const deadline=new AbortController(), combined=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
 const timer=setTimeout(()=>deadline.abort(),15000);
 const abort=()=>{void client?.close();};combined.addEventListener('abort',abort,{once:true});
 try {
  combined.throwIfAborted();
  const {library}=await readSelectorBundle(manifestPath,{signal:combined});
  combined.throwIfAborted();
  const child=fork(fileURLToPath(new URL('./selector-runtime.mjs',import.meta.url)),
   ['--internal-selector-worker',manifestPath,runtimeDirectory],
   {execArgv:[],env:childEnvironment(),windowsHide:true,silent:true,stdio:['ignore','ignore','ignore','ipc']});
  client=new SelectorClient(child,library);
  if(combined.aborted)await client.close();
  combined.throwIfAborted();await client.ready;combined.throwIfAborted();return client;
 } catch {await client?.close();throw Error('selector_unavailable');}
 finally {clearTimeout(timer);combined.removeEventListener('abort',abort);}
}