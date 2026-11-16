import { UserRequestLeaseV2 } from './user-request-lease-v2.mjs';
import { independentReplacement } from './presentation-replacement';
import { presentationSection } from './presentation-section.mjs';
import { validateAnnotations, type Annotations } from './presentation-annotations';
type Identity = { sourceRole?: 'assistant' | 'user_request'; sourceVersion?: number; documentId: string; threadId: string; turnId: string; generation: number; messageId?: string; textPrefix?: string; publicRevision?: number; remainingTtlMs?: number; section?: number; sourceStart?: number; sourceEnd?: number; sourceQuote?: string };
type Scene = { epoch: string; revision: number; partIds: string[] };
type Retirement = { retired: {epoch:string;sceneRevision:number;seq:number}; fallback:Scene };
type Scope = Identity & { epoch: string; sceneRevision: number; intentVersion: number; admissionVersion: number; prefixLength?: number };
type State = { documentId?: string; stopped: boolean; hidden: boolean; busy?: boolean; snapshot?: any; scene: Scene | null };
const sourceKeys = ['sourceStart', 'sourceEnd', 'sourceQuote'] as const;
const roleKeys = ['sourceRole','sourceVersion'] as const;
const sameScope = (issued: Scope, value: Scope) => value && [...Object.keys(issued), ...sourceKeys, ...roleKeys].every(key => value[key as keyof Scope] === issued[key as keyof Scope]);
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
export class UserRequestAdmissionV2 {
  private userPreview = new UserRequestLeaseV2(() => this.now());
  configureUserRequestPreviewV2() { const s=this.read();return this.userPreview.enable(s.documentId,s.snapshot); }
  private userSource() {const s=this.read();return this.userPreview.observe(s.documentId,s.snapshot);}
  userRequestSourceV2(identity: Identity) {const u=this.userSource();return u && (['documentId','threadId','generation','turnId','messageId'] as const).every(k=>u[k]===identity?.[k as keyof Identity]) && u.text===identity.sourceQuote ? {sourceVersion:u.sourceVersion,remainingTtlMs:u.deadline-this.now()} : null;}
  private userOwned?: {version:number; receipt:{epoch:string;sceneRevision:number;seq:number}};
  private applyUnknown = false;
  private lastUserAdmittedVersion = 0;
  private captureSource(capture:any) {
    const current=this.userSource();if(current)return current;
    if(capture?.receipt!==null||this.userOwned||this.issued?.scope.sourceRole==='user_request'||capture.sourceVersion<=this.lastUserAdmittedVersion)return null;
    const state=this.read(),expired=this.userPreview.deferenceSource(state.documentId,state.snapshot);
    return expired&&expired.sourceVersion===capture.sourceVersion?expired:null;
  }
  captureUserRequestV2() {
    const user=this.userSource(),owned=this.userOwned;
    return user ? {sourceVersion:user.sourceVersion,receipt:owned&&owned.version===user.sourceVersion ? {...owned.receipt} : null} : null;
  }
  private matchesUserCapture(capture:any) {
    const owned=this.userOwned,scope=this.issued?.scope,user=this.captureSource(capture);
    if(!user||capture?.sourceVersion!==user.sourceVersion)return false;
    if(capture.receipt===null)return !owned;
    return !!owned&&capture?.sourceVersion===owned.version&&scope?.sourceRole==='user_request'&&scope.sourceVersion===owned.version&&
      ['epoch','sceneRevision','seq'].every(k=>capture.receipt?.[k]===owned.receipt[k as keyof typeof owned.receipt]);
  }
  // Entire handoff is synchronous. Tombstone source authority, not current scene
  // ownership, so the ordinary prepared candidate keeps its original anchor.
  handoffUserRequestV2(value:any) {
    const stale={status:'rejected',code:'presentation_stale'};
    if(!this.matchesUserCapture(value?.capture))return stale;
    const user=this.captureSource(value.capture),prepared=this.prepared,identity=prepared?.scope;
    if(!user||!prepared||!identity||identity.sourceRole==='user_request'||!value?.scope||!sameScope(identity,value.scope)||
      !['documentId','threadId','generation','turnId'].every(k=>identity[k as keyof Scope]===user[k as keyof typeof user]))return stale;
    const state=this.read(),now=this.now();
    if(now<prepared.at||now>=prepared.at+prepared.leaseMs||!this.available(identity,state,prepared.textPrefix)||!this.preparedSceneMatches(prepared,state))return stale;
    const shot={scope:identity};
    if(!this.matchesUserCapture(value.capture)||!this.userPreview.tombstone(user.sourceVersion)){this.cancelPrepared(shot.scope);return stale;}
    const captured=this.userOwned;this.applyUnknown=false;
    if(value.retain===true){this.cancelPrepared(shot.scope);this.retireCapturedUser(captured);return {status:'retained'};}
    let result;
    try {
      result=this.applyPrepared({scope:shot.scope,body:value.body,annotations:value.annotations,replacement:value.replacement});
      if(this.applyUnknown||!['accepted','rejected'].includes(result?.status))throw Error('presentation_handoff_unknown');
    } catch(error){this.retireCapturedUser(captured);throw error;}
    if(result.status==='accepted'){this.userOwned=undefined;return result;}
    this.retireCapturedUser(captured);return result;
  }
  private retireCapturedUser(captured:UserRequestAdmissionV2['userOwned']) {
    if(!captured)return;
    // Caller-supplied callback must compare the complete receipt before clearing.
    this.retireUserGeometry(captured.receipt);
    if(this.userOwned===captured){this.userOwned=undefined;if(this.issued?.scope.sourceRole==='user_request')this.issued=undefined;}
  }
  private intent = 0;
  private serial = 0;
  private issued?: { scope: Scope; at: number; leaseMs: number; textPrefix?: string };
  private candidate?: NonNullable<UserRequestAdmissionV2['issued']>;
  private prepared?: NonNullable<UserRequestAdmissionV2['issued']> & {retirement?:Retirement};
  private preparationVersion = 0;
  private preparationSerial = 0;
  constructor(private read: () => State,
    private admit: (body: unknown, scope: Scope, valid: () => boolean, annotations: Annotations) => any,
    private now = () => performance.now(), private clearAnnotations: () => Retirement | void = () => {}, private boundedSourceLease = false, private retireUserGeometry: (receipt:{epoch:string;sceneRevision:number;seq:number}) => void = () => {throw Error('user_retirement_unavailable');}) {}
  invalidate() { this.userPreview.retire();this.userOwned=undefined;this.intent++; this.issued = undefined; this.candidate = undefined; this.prepared = undefined; try { this.clearAnnotations(); } catch { /* Visual cleanup must never block native chat publication. */ } }
  leaseDeadline(scope: Scope) {
    const issued=this.candidate && scope && sameScope(this.candidate.scope,scope) ? this.candidate : this.issued;
    try { const state=this.read(); if(!issued || !scope || !sameScope(issued.scope,scope) ||
      this.now()<issued.at || this.now()>=issued.at+issued.leaseMs || !this.available(issued.scope,state,issued.textPrefix) || !this.sceneMatches(issued.scope,state)) return null;
      return issued.at+issued.leaseMs;
    } catch {return null;}
  }
  private sceneMatches(scope: Scope, state: State) {
    // During our own animation chatSceneContext deliberately returns null.
    return state.scene ? state.scene.epoch === scope.epoch && state.scene.revision === scope.sceneRevision : state.busy === true;
  }
  reconcile() {
    try {
      this.userSource();
      const state = this.read(), prepared = this.prepared;
      if (prepared && (this.now() < prepared.at || this.now() >= prepared.at + prepared.leaseMs ||
        !this.available(prepared.scope,state,prepared.textPrefix) || !this.preparedSceneMatches(prepared,state))) this.prepared=undefined;
      const issued=this.issued;
      if (!issued) return false;
      const age=this.now()-issued.at;
      if (age>=0 && age<issued.leaseMs && this.sceneMatches(issued.scope,state) && this.available(issued.scope,state,issued.textPrefix)) return false;
      if(age>=issued.leaseMs && this.retireForCandidate(issued,state))return true;
      this.invalidate();return true;
    } catch {this.invalidate();return true;}
  }
  private preparedSceneMatches(prepared: NonNullable<UserRequestAdmissionV2['prepared']>, state: State) {
    const fallback=prepared.retirement?.fallback;
    return this.sceneMatches(fallback ? {...prepared.scope,epoch:fallback.epoch,sceneRevision:fallback.revision} : prepared.scope,state);
  }
  private retireForCandidate(issued: NonNullable<UserRequestAdmissionV2['issued']>, state: State) {
    const prepared=this.prepared;
    if(!prepared || prepared.retirement || !state.scene || !this.available(issued.scope,state,issued.textPrefix) ||
      !this.sceneMatches(issued.scope,state) || prepared.scope.epoch!==issued.scope.epoch || prepared.scope.sceneRevision!==issued.scope.sceneRevision)return false;
    const retirement=this.clearAnnotations(), after=this.read();this.issued=undefined;
    if(this.prepared!==prepared || this.intent!==prepared.scope.intentVersion || !retirement || retirement.retired.epoch!==issued.scope.epoch || retirement.retired.sceneRevision!==issued.scope.sceneRevision ||
      !Number.isSafeInteger(retirement.retired.seq) || !after.scene || after.scene.epoch!==retirement.fallback.epoch ||
      after.scene.revision!==retirement.fallback.revision || !this.available(prepared.scope,after,prepared.textPrefix))return false;
    prepared.retirement=retirement;return true;
  }
  preparationTicket() {return {intentVersion:this.intent,preparationVersion:++this.preparationSerial};}
  prepare(identity: Identity, ticket?: {intentVersion:number;preparationVersion:number}) {
    if (this.candidate || typeof identity?.textPrefix !== 'string' || ticket !== undefined && (ticket.intentVersion!==this.intent || !Number.isSafeInteger(ticket.preparationVersion) || ticket.preparationVersion<=this.preparationVersion || ticket.preparationVersion>this.preparationSerial)) return null;
    const displayed = this.issued; this.prepared = undefined;
    try {
      const shot = this.snapshot(identity);
      if (shot && this.issued) {this.prepared = {...this.issued};if(ticket)this.preparationVersion=ticket.preparationVersion;}
      return shot;
    } finally { this.issued = displayed; }
  }
  cancelPrepared(scope: Scope) {
    if (this.prepared && sameScope(this.prepared.scope,scope)) this.prepared = undefined;
  }
  applyPrepared(value: { scope: Scope; body: any; annotations?: unknown; replacement?: boolean }) {
    const prepared = this.prepared;
    const stale = {status:'rejected',code:'presentation_stale'};
    if (!prepared || !value?.scope || !sameScope(prepared.scope,value.scope)) return stale;
    try {
      const state=this.read(), remaining=prepared.at+prepared.leaseMs-this.now();
      if (remaining <= 0 || this.now() < prepared.at || !this.available(prepared.scope,state,prepared.textPrefix)) {this.prepared=undefined;return stale;}
      if (!state.scene && state.busy) return {status:'rejected',code:'presentation_busy'};
      if (!state.scene || !this.preparedSceneMatches(prepared,state)) {this.prepared=undefined;return stale;}
      const retired=prepared.retirement;
      if(retired && (value.replacement!==true || !independentReplacement(value.body))) {this.prepared=undefined;return stale;}
      const admitted=retired ? {...prepared,scope:{...prepared.scope,epoch:retired.fallback.epoch,sceneRevision:retired.fallback.revision}} : prepared;
      this.prepared=undefined;
      if(this.candidate)return {status:'rejected',code:'presentation_busy'};
      this.candidate=admitted;
      try {return this.applyIssued({...value,scope:admitted.scope},admitted,true);}
      finally {if(this.candidate===admitted)this.candidate=undefined;}
    } catch {this.prepared=undefined;return stale;}
  }
  private available(identity: Identity, state: State, textPrefix?: string) {
    if(identity.sourceRole==='user_request'){const u=this.userSource();return !!u && identity.sourceVersion===u.sourceVersion && (['documentId','threadId','generation','turnId','messageId'] as const).every(k=>u[k]===identity[k as keyof Identity]) && textPrefix===u.text && !state.stopped&&!state.hidden;}
    if(identity.sourceRole!==undefined&&identity.sourceRole!=='assistant')return false;
    const chat = state.snapshot, lastUser = chat?.messages?.filter((m: any) => m.role === 'user').at(-1);
    if (state.stopped || state.hidden || state.documentId !== identity.documentId || chat?.available !== true ||
        chat.pending || chat.stopping || chat.error || chat.generation !== identity.generation ||
        chat.threadId !== identity.threadId || lastUser?.turn !== identity.turnId) return false;
    if (textPrefix !== undefined) {
      const message = chat.messages.find((m: any) => m.role === 'assistant' && m.id === identity.messageId && m.turn === identity.turnId);
      return (chat.ownerTurn === identity.turnId || chat.ownerTurn === null && message?.status === 'completed') &&
        Number.isSafeInteger(chat.revision) && chat.revision >= identity.publicRevision! &&
        message && !message.truncated && ['streaming', 'completed'].includes(message.status) &&
        typeof message.text === 'string' && message.text.startsWith(textPrefix) &&
        (this.boundedSourceLease || presentationSection(message.text) === identity.section) && presentationSection(textPrefix) === identity.section;
    }
    return !chat.ownerTurn && chat.messages.some((m: any) => m.role === 'assistant' && m.turn === identity.turnId && m.status === 'completed' && !m.truncated);
  }
  snapshot(identity: Identity) {
    try {
      if (!identity || !['documentId', 'threadId', 'turnId'].every(key => id(identity[key as keyof Identity])) ||
          !Number.isSafeInteger(identity.generation) || identity.generation < 0) return null;
      const streaming = identity.textPrefix !== undefined || identity.messageId !== undefined || identity.publicRevision !== undefined;
      if (streaming && (!id(identity.messageId) || typeof identity.textPrefix !== 'string' || !identity.textPrefix.trim() ||
          new TextEncoder().encode(identity.textPrefix).length > 64000 || !Number.isSafeInteger(identity.publicRevision) || identity.publicRevision! < 0 ||
          !Number.isSafeInteger(identity.section) || identity.section! < 0 || !Number.isFinite(identity.remainingTtlMs) || identity.remainingTtlMs! <= 0 || identity.remainingTtlMs! > 30000)) return null;
      const sourced = sourceKeys.some(key => Object.hasOwn(identity,key));
      if (sourced && (!streaming || !sourceKeys.every(key => Object.hasOwn(identity,key)) ||
          !Number.isSafeInteger(identity.sourceStart) || !Number.isSafeInteger(identity.sourceEnd) ||
          identity.sourceStart! < identity.section! || identity.sourceEnd! <= identity.sourceStart! || identity.sourceEnd! > identity.textPrefix!.length ||
          typeof identity.sourceQuote !== 'string' || !identity.sourceQuote.trim() ||
          identity.textPrefix!.slice(identity.sourceStart,identity.sourceEnd) !== identity.sourceQuote ||
          /[\uDC00-\uDFFF]/u.test(identity.textPrefix![identity.sourceStart!] ?? '') || /[\uDC00-\uDFFF]/u.test(identity.textPrefix![identity.sourceEnd!] ?? ''))) return null;
      const state = this.read();
      if (!this.available(identity, state, identity.textPrefix) || !state.scene) return null;
      const user=identity.sourceRole==='user_request'?this.userSource():null;
      if(identity.sourceRole==='user_request'&&(!user||user.sourceVersion!==identity.sourceVersion))return null;
      const scope = { ...(identity.sourceRole?{sourceRole:identity.sourceRole,...(user?{sourceVersion:user.sourceVersion}:{})}:{}), documentId: identity.documentId, threadId: identity.threadId, turnId: identity.turnId, generation: identity.generation, epoch: state.scene.epoch, sceneRevision: state.scene.revision, intentVersion: this.intent, admissionVersion: ++this.serial,
        ...(streaming ? { messageId: identity.messageId, section: identity.section, publicRevision: identity.publicRevision, prefixLength: identity.textPrefix!.length } : {}),
        ...(sourced ? { sourceStart: identity.sourceStart, sourceEnd: identity.sourceEnd, sourceQuote: identity.sourceQuote } : {}) };
      const at=this.now();
      this.issued = { scope, at, leaseMs: user ? Math.min(identity.remainingTtlMs!,user.deadline-at,10000) : streaming ? Math.min(identity.remainingTtlMs!, this.boundedSourceLease ? 10000 : 30000) : 120000, ...(streaming ? { textPrefix: identity.textPrefix } : {}) };
      return { scope: { ...scope }, partIds: [...state.scene.partIds] };
    } catch { return null; }
  }
  replace(value: { identity: Identity; body: unknown; annotations?: unknown }) {
    if (!value?.identity) return { status: 'rejected', code: 'presentation_stale' };
    if (this.candidate) return { status: 'rejected', code: 'presentation_busy' };
    const displayed=this.issued, shot=this.snapshot(value.identity);
    if (!shot) return { status: 'rejected', code: 'presentation_stale' };
    const candidate=this.issued!; this.issued=displayed; this.candidate=candidate;
    try { return this.applyIssued({scope:shot.scope,body:value.body,annotations:value.annotations},candidate,true); }
    finally { if(this.candidate===candidate)this.candidate=undefined; }
  }
  apply(value: { scope: Scope; body: unknown; annotations?: unknown }) {
    return this.applyIssued(value,this.issued,false);
  }
  private applyIssued(value: { scope: Scope; body: unknown; annotations?: unknown }, issued: UserRequestAdmissionV2['issued'], candidate: boolean) {
    const owns=()=>issued && (candidate ? this.candidate===issued : this.issued===issued);
    const valid = () => {
      try {
        if (!owns() || !issued || !value?.scope ||
            !sameScope(issued.scope,value.scope)) return false;
        const state = this.read(), age = this.now() - issued.at;
        return age >= 0 && age < issued.leaseMs && this.available(issued.scope, state, issued.textPrefix) &&
          state.scene?.epoch === issued.scope.epoch && state.scene.revision === issued.scope.sceneRevision;
      } catch { return false; }
    };
    if (!valid()) {
      let state: State; try { state = this.read(); } catch { return { status: 'rejected', code: 'presentation_stale' }; }
      const age = issued ? this.now() - issued.at : Infinity;
      const same = issued && value?.scope && sameScope(issued.scope,value.scope);
      return { status: 'rejected', code: same && age >= 0 && age < issued!.leaseMs && state.busy && this.available(issued!.scope, state, issued!.textPrefix) ? 'presentation_busy' : 'presentation_stale' };
    }
    let annotations: Annotations;
    try { annotations=validateAnnotations(value.annotations); }
    catch { if(!candidate && owns())this.invalidate();return {status:'rejected',code:'presentation_invalid'}; }
    try {
      let result;
      try {result = this.admit(value.body, issued!.scope, valid, annotations);} catch(error){this.applyUnknown=true;throw error;}
      // An accepted callback may already have mutated geometry. Incomplete receipts
      // cannot be reported as a known rejection or used for exact ownership cleanup.
      if(result?.status==='accepted'&&(!Number.isSafeInteger(result.sceneRevision)||result.sceneRevision<0||
        !Number.isSafeInteger(result.seq)||result.seq<0||!id(result.epoch))) {
        this.applyUnknown=true;
        if(owns())this.invalidate();
        return {status:'rejected',code:'presentation_invalid'};
      }
      if(result?.status==='accepted'&&issued!.scope.sourceRole==='user_request'){
        this.lastUserAdmittedVersion=Math.max(this.lastUserAdmittedVersion,issued!.scope.sourceVersion!);
        this.userOwned={version:issued!.scope.sourceVersion!,receipt:{epoch:result.epoch,sceneRevision:result.sceneRevision,seq:result.seq}};
      }
      if (result?.status === 'accepted' && Number.isSafeInteger(result.sceneRevision) && owns()) {
        const scope = { ...issued!.scope, sceneRevision: result.sceneRevision, admissionVersion: ++this.serial };
        this.issued = { scope, at: issued!.at, leaseMs: issued!.leaseMs, textPrefix: issued!.textPrefix };
        return { ...result, scope: { ...scope } };
      }
      if (result?.status === 'accepted' && owns()) { this.invalidate(); return {status:'rejected',code:'presentation_invalid'}; }
      if (!candidate && owns()) this.invalidate(); return result;
    } catch { if (owns()) this.invalidate(); return { status: 'rejected', code: 'presentation_invalid' }; }
  }
}
