import { createHash } from 'node:crypto';
import { diagramAuthorPolicy } from './diagram-author.mjs';

// Two independent model lanes; speculative output never owns browser admission.
export class PrefetchPresentationProvider {
  constructor({primary, speculative}) { if(!primary||!speculative||primary===speculative)throw Error('prefetch_independent_providers');Object.assign(this,{primary,speculative}); }
  key(exchange, source) {
    if (!source) return null;
    const config = p => [p.visualModel,p.visualEffort,p.protocol,p.compact,p.miniScene,p.host,p.runtime?.cwd,p.runtime?.env?.FISCH_CODEX_SERVICE_TIER];
    if(JSON.stringify(config(this.primary))!==JSON.stringify(config(this.speculative)))throw Error('prefetch_configuration_mismatch');
    return createHash('sha256').update(JSON.stringify({exchange,source,policy:diagramAuthorPolicy,config:[config(this.primary),config(this.speculative)]})).digest('hex');
  }
  emit(req,type,detail){try{req.onEvent?.(type,detail);}catch{}}
  current(req) { return !this.closed&&!req.controller.signal.aborted&&!req.signal.aborted&&req.isCurrent()&&req.remainingMs()>0; }
  prefetch(exchange, source, options) {
    if(this.closed||!source||Buffer.byteLength(JSON.stringify(exchange))>65536)return;
    const key=this.key(exchange,source);
    if(key===this.mainKey||key===this.active?.key||key===this.cached?.key)return;
    this.queued={key,exchange,source,...options,controller:new AbortController(),records:[]};
    this.pump();
  }
  pump() {
    if(this.active||this.closed||!this.queued)return;
    const req=this.queued;this.queued=null;
    if(!this.current(req)||req.key===this.mainKey)return;
    this.active=req;req.abort=()=>req.controller.abort();req.signal.addEventListener('abort',req.abort,{once:true});
    req.timer=setTimeout(req.abort,Math.max(1,req.remainingMs()));
    this.emit(req,'prefetch_start',{key:req.key,source:req.source});
    req.promise=Promise.resolve().then(()=>{if(!this.current(req))throw Error('prefetch_source_stale');return this.speculative.generate(req.exchange,req.controller.signal,{partIds:[]},{
      isCurrent:()=>this.current(req),onConfiguration:config=>this.emit(req,'prefetch_configuration',{key:req.key,config}),onPhase:phase=>this.emit(req,'prefetch_phase',{key:req.key,phase}),
      onUsage:usage=>this.emit(req,'prefetch_usage',{key:req.key,usage}),
      onRecord:record=>this.record(req,record)
    });}).catch(error=>{req.error=error;throw error;}).finally(()=>this.finished(req));
    req.promise.catch(()=>{});
  }
  record(req,record) {
    if(!this.current(req))throw Error('prefetch_source_stale');
    if(req.records.length)throw Error('prefetch_multiple_records');
    req.records.push(record);
    if(req.consumer&&req.consumer.isCurrent())req.consumer.onRecord(record);
  }
  finished(req) {
    clearTimeout(req.timer);req.signal.removeEventListener('abort',req.abort);
    if(!req.error&&!req.claimed&&this.current(req))this.cached=req;
    this.emit(req,'prefetch_end',{key:req.key,claimed:!!req.claimed,error:req.error?.message,records:req.records.length});
    if(this.active===req)this.active=null;
    this.pump();
  }
  async generate(exchange,signal,scene,streaming) {
    if(this.busy||this.closed||signal.aborted||streaming?.isCurrent?.()===false)throw Error('presentation_unavailable');
    const key=this.key(exchange,streaming?.sourceIdentity);this.busy=true;this.mainKey=key;
    if(this.queued?.key===key)this.queued=null;
    const req=[this.active,this.cached].find(r=>r?.key===key&&!r.error&&this.current(r));
    try {
      if(!req)return await this.primary.generate(exchange,signal,scene,streaming);
      req.claimed=true;if(this.cached===req)this.cached=null;
      const abort=()=>req.controller.abort();signal.addEventListener('abort',abort,{once:true});
      try {
        if(signal.aborted)abort();req.consumer=streaming;
        streaming.onPhase?.('prefetch_claimed');
        for(const record of req.records){if(signal.aborted||!streaming.isCurrent())throw Error('prefetch_source_stale');streaming.onRecord(record);}
        await req.promise;
        if(signal.aborted||!streaming.isCurrent())throw Error('prefetch_source_stale');
      } finally {req.consumer=null;signal.removeEventListener('abort',abort);}
    } finally {this.busy=false;this.mainKey=null;this.pump();}
  }
  invalidate() {
    this.queued=null;this.cached=null;this.active?.controller.abort();
  }
  close() { this.closed=true;this.invalidate();this.primary.close();this.speculative.close(); }
}
