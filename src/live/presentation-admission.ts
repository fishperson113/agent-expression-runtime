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
  constructor(private read: () => State,
    private admit: (body: unknown, scope: Scope, valid: () => boolean, annotations: Annotations) => any,
    private now = () => performance.now(), private clearAnnotations = () => {}, private boundedSourceLease = false) {}
  invalidate() { this.intent++; this.issued = undefined; try { this.clearAnnotations(); } catch { /* Visual cleanup must never block native chat publication. */ } }
  leaseDeadline(scope: Scope) {
    const issued=this.issued;
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
    if (!this.issued) return false;
    try { const issued=this.issued, state=this.read(), age=this.now()-issued.at;
      if (age>=0 && age<issued.leaseMs && this.sceneMatches(issued.scope,state) && this.available(issued.scope,state,issued.textPrefix)) return false; } catch { /* Fail closed on unavailable public state. */ }
    this.invalidate(); return true;
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
  apply(value: { scope: Scope; body: unknown; annotations?: unknown }) {
    const issued = this.issued;
    const valid = () => {
      try {
        if (!issued || this.issued !== issued || !value?.scope ||
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
    try {
      const annotations = validateAnnotations(value.annotations);
      const result = this.admit(value.body, issued!.scope, valid, annotations);
      if (result?.status === 'accepted' && Number.isSafeInteger(result.sceneRevision) && this.issued === issued) {
        const scope = { ...issued!.scope, sceneRevision: result.sceneRevision, admissionVersion: ++this.serial };
        this.issued = { scope, at: issued!.at, leaseMs: issued!.leaseMs, textPrefix: issued!.textPrefix };
        return { ...result, scope: { ...scope } };
      }
      if (this.issued === issued) this.invalidate(); return result;
    } catch { if (this.issued === issued) this.invalidate(); return { status: 'rejected', code: 'presentation_invalid' }; }
  }
}
