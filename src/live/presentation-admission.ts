import { presentationSection } from './presentation-section.mjs';
import { validateAnnotations, type Annotations } from './presentation-annotations';
type Identity = { documentId: string; threadId: string; turnId: string; generation: number; messageId?: string; textPrefix?: string; publicRevision?: number; remainingTtlMs?: number; section?: number; sourceStart?: number; sourceEnd?: number; sourceQuote?: string };
type Scene = { epoch: string; revision: number; partIds: string[] };
type Scope = Identity & { epoch: string; sceneRevision: number; intentVersion: number; admissionVersion: number; prefixLength?: number };
type State = { documentId?: string; stopped: boolean; hidden: boolean; busy?: boolean; snapshot?: any; scene: Scene | null };
const sourceKeys = ['sourceStart', 'sourceEnd', 'sourceQuote'] as const;
const sameScope = (issued: Scope, value: Scope) => value && [...Object.keys(issued), ...sourceKeys].every(key => value[key as keyof Scope] === issued[key as keyof Scope]);
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
export class PresentationAdmission {
  private intent = 0;
  private serial = 0;
  private issued?: { scope: Scope; at: number; leaseMs: number; textPrefix?: string };
  private candidate?: NonNullable<PresentationAdmission['issued']>;
  private prepared?: NonNullable<PresentationAdmission['issued']>;
  private preparationVersion = -Infinity;
  constructor(private read: () => State,
    private admit: (body: unknown, scope: Scope, valid: () => boolean, annotations: Annotations) => any,
    private now = () => performance.now(), private clearAnnotations = () => {}, private boundedSourceLease = false) {}
  invalidate() { this.preparationVersion=Math.max(this.preparationVersion,performance.timeOrigin+this.now()); this.intent++; this.issued = undefined; this.candidate = undefined; this.prepared = undefined; try { this.clearAnnotations(); } catch { /* Visual cleanup must never block native chat publication. */ } return this.preparationVersion; }
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
      const state = this.read(), prepared = this.prepared;
      if (prepared && (this.now() < prepared.at || this.now() >= prepared.at + prepared.leaseMs ||
        !this.available(prepared.scope,state,prepared.textPrefix) || !this.sceneMatches(prepared.scope,state))) this.prepared=undefined;
      const issued=this.issued;
      if (!issued) return false;
      const age=this.now()-issued.at;
      if (age>=0 && age<issued.leaseMs && this.sceneMatches(issued.scope,state) && this.available(issued.scope,state,issued.textPrefix)) return false;
      this.invalidate();return true;
    } catch {this.invalidate();return true;}
  }
  prepare(identity: Identity, version?: number) {
    if (this.candidate || typeof identity?.textPrefix !== 'string' || version !== undefined && (!Number.isFinite(version) || version <= this.preparationVersion)) return null;
    const displayed = this.issued; this.prepared = undefined;
    try {
      const shot = this.snapshot(identity);
      if (shot && this.issued) {this.prepared = {...this.issued};if(version!==undefined)this.preparationVersion=version;}
      return shot;
    } finally { this.issued = displayed; }
  }
  cancelPrepared(scope: Scope) {
    if (this.prepared && sameScope(this.prepared.scope,scope)) this.prepared = undefined;
  }
  applyPrepared(value: { scope: Scope; body: any; annotations?: unknown }) {
    const prepared = this.prepared;
    const stale = {status:'rejected',code:'presentation_stale'};
    if (!prepared || !value?.scope || !sameScope(prepared.scope,value.scope)) return stale;
    try {
      const state=this.read(), remaining=prepared.at+prepared.leaseMs-this.now();
      if (remaining <= 0 || this.now() < prepared.at || !this.available(prepared.scope,state,prepared.textPrefix)) {this.prepared=undefined;return stale;}
      if (!state.scene && state.busy) return {status:'rejected',code:'presentation_busy'};
      if (!state.scene || state.scene.epoch!==prepared.scope.epoch || state.scene.revision!==prepared.scope.sceneRevision) {this.prepared=undefined;return stale;}
      this.prepared=undefined;
      if(this.candidate)return {status:'rejected',code:'presentation_busy'};
      this.candidate=prepared;
      try {return this.applyIssued(value,prepared,true);}
      finally {if(this.candidate===prepared)this.candidate=undefined;}
    } catch {this.prepared=undefined;return stale;}
  }
  private available(identity: Identity, state: State, textPrefix?: string) {
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
      const scope = { documentId: identity.documentId, threadId: identity.threadId, turnId: identity.turnId, generation: identity.generation, epoch: state.scene.epoch, sceneRevision: state.scene.revision, intentVersion: this.intent, admissionVersion: ++this.serial,
        ...(streaming ? { messageId: identity.messageId, section: identity.section, publicRevision: identity.publicRevision, prefixLength: identity.textPrefix!.length } : {}),
        ...(sourced ? { sourceStart: identity.sourceStart, sourceEnd: identity.sourceEnd, sourceQuote: identity.sourceQuote } : {}) };
      this.issued = { scope, at: this.now(), leaseMs: streaming ? Math.min(identity.remainingTtlMs!, this.boundedSourceLease ? 10000 : 30000) : 120000, ...(streaming ? { textPrefix: identity.textPrefix } : {}) };
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
  private applyIssued(value: { scope: Scope; body: unknown; annotations?: unknown }, issued: PresentationAdmission['issued'], candidate: boolean) {
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
      const result = this.admit(value.body, issued!.scope, valid, annotations);
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
