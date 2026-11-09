import type { CausalKind, CausalPayloads } from './causal-recorder-types';
import { ReactiveDecisionHost } from './decision-host';
import { ReactiveLeaseGuard, type LeaseRevokeReason } from './reactive-lease';
import { handEventKinds, validateObservation, validateSourceEvent } from './observation';
import { freezeHandReadSet, matchesHandReadSet, type HandReadSet, type DecisionResult, type ReactiveRequest, type ReactiveState } from './decision-types';
import type { Observation } from './types';
import type { ReactiveWindow, ReactiveWindowEvent, SessionEvent, SessionOptions } from './reactive-session-types';

const faceEvents = new Set(['user_arrived', 'user_left', 'looked_away', 'looked_back', 'expression_changed']);
const revokeReasons: Record<string, LeaseRevokeReason> = { presence_changed: 'presence_changed', session_changed: 'session_changed',
  epoch_changed: 'epoch_changed', hand_changed: 'hand_changed', semantic_changed: 'semantic_changed', user_intent: 'intent_changed', user_busy: 'intent_changed', deadline: 'expired', source_expired: 'expired', track_lost: 'track_lost' };
const isHand = (event: SessionEvent): event is import('./types').HandWireEvent & { seq: number } => 'eventVersion' in event;
const key = (event: SessionEvent) => isHand(event) ? (event.type === 'hand_appeared' || event.type === 'hand_lost' ? 'hand_presence' : `hand_motion:${event.trackId}`)
  : event.type.startsWith('user_') ? 'presence' : event.type.startsWith('looked_') ? 'orientation' : 'expression';
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
type PendingEvent = SessionEvent & { sessionId: string; observationSeq: number };
type Transport = { id: string; request: ReactiveRequest; generation: number; authorized: boolean; delivered: boolean; done: Promise<DecisionResult>;
  authorizationOutcome?: boolean; owner?: import('./decision-types').ReactiveOwnership; resolve: (value: unknown) => void; reject: () => void };

/** Pure coordinator. It never contacts a provider or writes to a renderer directly. */
export class ReactiveSession {
  private available = false;
  private enabled = false;
  private userBusy = false;
  private snapshot?: Observation;
  private history: Observation[] = [];
  private pending = new Map<string, PendingEvent>();
  private firstAt = 0;
  private seen = -1;
  private intentRevision = 0;
  private presenceRevision = 0;
  private starts: number[] = [];
  private lastStart = -Infinity;
  private lastNow = -Infinity;
  private lastWall = -Infinity;
  private epoch = '';
  private sourceValid = false;
  private handGeneration?: number;
  private transport?: Transport;
  private uncertain = false;
  private count = 0;
  private ids = new Set<string>();
  private lastReason: string = 'disabled';
  private host: ReactiveDecisionHost;
  private guard: ReactiveLeaseGuard;
  constructor(private options: SessionOptions) {
    this.epoch = options.epoch();
    this.host = new ReactiveDecisionHost(() => this.readCurrent(), options.now);
    this.guard = new ReactiveLeaseGuard(() => this.readCurrent(), options.now, (owner, reason) => {
      this.record('revocation', { reason, requestId: owner.requestId, decisionId: owner.decisionId, actionId: owner.actionId });
      options.cancel(owner, reason);
    });
  }
  private record<K extends CausalKind>(kind: K, payload: CausalPayloads[K]) {
    if (!this.options.record) return;
    try { this.options.record(kind, structuredClone(payload)); } catch { /* Recording cannot affect control. */ }
  }
  configure(available: boolean) {
    this.available = available === true;
    if (!this.available) { this.enabled = false; this.revoke('unavailable'); }
  }
  enable(enabled: boolean) {
    this.enabled = enabled === true && this.available;
    this.history = []; this.revoke(this.enabled ? 'enabled' : 'disabled');
  }
  userIntent() { this.intentRevision++; this.revoke('user_intent'); }
  setUserBusy(busy: boolean) { this.userBusy = busy === true; if (this.userBusy) this.revoke('user_busy'); }
  reset() { this.clearSource('reset'); }
  private clearSource(reason: CausalPayloads['revocation']['reason']) {
    this.revoke(reason); this.snapshot = undefined; this.history = []; this.seen = -1;
    this.presenceRevision++; this.sourceValid = false;
  }
  private revoke(reason: CausalPayloads['revocation']['reason']) {
    const transport = this.transport;
    if (!this.guard.owner && transport?.generation === this.guard.generation) this.record('revocation', { reason, requestId: transport.id });
    this.lastReason = reason; this.pending.clear(); this.host.revoke(); this.guard.revoke(revokeReasons[reason] ?? 'revoked');
  }
  private fresh(at: number, ttl: number) {
    const wall = this.options.wallNow();
    return Number.isFinite(at) && at <= wall && wall - at <= ttl;
  }
  private healthy() { return this.sourceValid && !!this.snapshot && this.fresh(this.snapshot.capturedAt, 1500); }
  private tracks() {
    return this.healthy() && this.snapshot?.hands?.trackingState === 'tracked'
      ? this.snapshot.hands.entities.flatMap(hand => hand.trackId ? [hand.trackId] : []) : [];
  }
  private readCurrent(): ReactiveState {
    return { sessionId: this.healthy() ? this.snapshot!.sessionId : 'unavailable', epoch: this.options.epoch(),
      intentRevision: this.intentRevision, presenceRevision: this.presenceRevision, handState: this.handState(), trackIds: this.tracks() };
  }
  private handState(): HandReadSet | undefined {
    try { const state = this.options.handState?.(); return state === undefined ? undefined : freezeHandReadSet(state); } catch { return; }
  }
  private handEligible(event: SessionEvent, state = this.handState()) {
    return !isHand(event) || !!state && event.sourceGeneration === state.sourceGeneration && event.stateRevision <= state.stateRevision &&
      (event.type === 'hand_lost' ? state.primaryTrackId === null : state.primaryTrackId === event.trackId);
  }
  private syncHandSource() {
    const state = this.handState(), generation = state?.sourceGeneration;
    if (this.handGeneration !== generation && ([...this.pending.values()].some(isHand) || this.transport?.request.handReadSet || this.guard.owner?.handReadSet)) this.revoke('hand_changed');
    this.handGeneration = generation;
    for (const [name, event] of this.pending) if (!this.handEligible(event, state)) this.pending.delete(name);
  }
  observe(value: Observation, events: SessionEvent[]) {
    this.tick();
    let snapshot: Observation;
    try { snapshot = validateObservation(value); } catch { this.sourceValid = false; this.revoke('invalid_observation'); return; }
    const old = this.snapshot;
    if (old && snapshot.sessionId === old.sessionId && snapshot.seq <= old.seq) return;
    if (old && snapshot.sessionId !== old.sessionId) this.clearSource('session_changed');
    if (old && snapshot.user.present !== old.user.present) { this.presenceRevision++; this.revoke('presence_changed'); }
    if (old && (snapshot.capturedAt < old.capturedAt || snapshot.capturedAt - old.capturedAt > 1500)) { this.history = []; this.revoke('capture_discontinuity'); }
    const previousTracks = this.tracks();
    this.snapshot = snapshot;
    this.sourceValid = ['tracking', 'absent'].includes(snapshot.camera) && this.fresh(snapshot.capturedAt, 1500);
    if (!this.sourceValid) this.revoke('source_unavailable');
    else if (previousTracks.some(track => !this.tracks().includes(track)) && this.transport?.request.requiredTrackIds.some(track => !this.tracks().includes(track))) this.revoke('track_lost');
    this.guard.check();
    this.history.push(snapshot); this.history = this.history.filter(item => this.fresh(item.capturedAt, 1500)).slice(-4);
    this.record('observation', { ...snapshot, summary: '' });
    this.events(events);
  }
  private events(events: SessionEvent[]) {
    if (!Array.isArray(events)) { this.revoke('invalid_events'); return; }
    for (const event of events.slice(-8)) {
      if (!event || !Number.isSafeInteger(event.seq) || event.seq < 0 || event.seq <= this.seen) continue;
      this.seen = event.seq;
      let source;
      try { const { seq, ...value } = event; source = validateSourceEvent(value);
        if (source.sourceSeq !== undefined && source.sourceSeq !== seq || 'observationSeq' in source && source.observationSeq > this.snapshot!.seq) throw Error('event');
      } catch { this.revoke('invalid_events'); continue; }
      if (!this.enabled || !this.available || !this.sourceValid || (!faceEvents.has(source.type) && !handEventKinds.includes(source.type as never)) || !this.fresh(source.at, 5000)) continue;
      const candidate = { ...source, sessionId: this.snapshot!.sessionId, observationSeq: 'observationSeq' in source ? source.observationSeq : this.snapshot!.seq, seq: event.seq } as PendingEvent;
      this.record('event', candidate);
      if (!this.handEligible(candidate)) continue;
      if (this.guard.owner || this.transport?.generation === this.guard.generation) this.revoke('semantic_changed');
      if (!this.pending.size) this.firstAt = this.options.now();
      this.pending.set(key(candidate), candidate);
      while (this.pending.size > 8) this.pending.delete(this.pending.keys().next().value!);
    }
  }
  private windowEvent(event: PendingEvent): ReactiveWindowEvent {
    const { sessionId, seq, observationSeq, ...source } = event;
    return 'eventVersion' in source ? { ...source, id: seq, observationSeq } : { id: seq, type: source.type, at: source.at };
  }
  tick() {
    this.syncHandSource();
    const now = this.options.now(), wall = this.options.wallNow(), epoch = this.options.epoch();
    if (!Number.isFinite(now) || !Number.isFinite(wall) || now < 0 || now < this.lastNow || wall < this.lastWall) this.revoke('clock_discontinuity');
    if (epoch !== this.epoch) { this.epoch = epoch; this.revoke('epoch_changed'); }
    this.lastNow = now; this.lastWall = wall;
    if (this.sourceValid && this.snapshot && !this.fresh(this.snapshot.capturedAt, 1500)) { this.sourceValid = false; this.revoke('source_expired'); }
    if (this.transport && now >= this.transport.request.deadline && this.lastReason !== 'deadline') this.revoke('deadline');
    for (const [name, event] of this.pending) if (!this.fresh(event.at, 5000)) this.pending.delete(name);
    this.starts = this.starts.filter(at => now - at < 60000);
    this.guard.check();
  }
  takeRequest(): { request: ReactiveRequest; observationWindow: ReactiveWindow } | null {
    this.tick(); const now = this.options.now();
    if (!Number.isFinite(now) || now < 0 || !this.available || !this.enabled || this.userBusy || !this.sourceValid || !this.history.length || !this.options.canAdmit() ||
      this.transport || this.uncertain || this.guard.owner || !this.pending.size || now - this.firstAt < 750 ||
      now - this.lastStart < 15000 || this.starts.length >= 4 || this.count >= 256) return null;
    const requestId = this.options.id();
    if (![requestId, this.snapshot!.sessionId, this.options.epoch()].every(id => /^[a-zA-Z0-9_-]{1,64}$/.test(id)) || this.ids.has(requestId)) { this.revoke('invalid_request_id'); return null; }
    const candidates = [...this.pending.values()], hand = candidates.some(isHand) ? this.handState() : undefined;
    if (candidates.some(isHand) && !hand) { this.revoke('hand_changed'); return null; }
    this.ids.add(requestId);
    const request: ReactiveRequest = frozen({ schemaVersion: 1, sessionId: this.snapshot!.sessionId, epoch: this.options.epoch(),
      requestId, intentRevision: this.intentRevision, presenceRevision: this.presenceRevision,
      deadline: now + 5000, requiredTrackIds: this.tracks(), ...(hand ? { handReadSet: hand } : {}) });
    const observationWindow: ReactiveWindow = frozen({ schemaVersion: 1, request,
      events: candidates.map(event => this.windowEvent(event)), observations: structuredClone(this.history) });
    this.record('request', { request, observationRefs: observationWindow.observations.map(value => ({ sessionId: value.sessionId, seq: value.seq })),
      eventRefs: candidates.map(value => ({ sessionId: value.sessionId, seq: value.seq })) });
    this.pending.clear(); this.lastStart = now; this.starts.push(now); this.count++;
    this.dispatch(request); return { request, observationWindow };
  }
  private dispatch(request: ReactiveRequest) {
    let resolve!: (value: unknown) => void, reject!: () => void;
    const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = () => no(Error('transport_unknown')); });
    const generation = this.guard.generation;
    const done = this.host.run(request, { decide: () => promise }, (compiled, owner) => {
      if (!this.enabled || !this.available || !this.healthy() || this.userBusy || !this.options.canAdmit() || !this.guard.acquire(request, owner, generation)) throw Error('admission_revoked');
      if (this.transport?.id === owner.requestId) this.transport.owner = owner;
      try { this.options.admit(compiled, owner); }
      catch (error) { this.guard.revoke(); throw error; }
    });
    this.transport = { id: request.requestId, request, generation, authorized: false, delivered: false, resolve, reject, done };
  }
  private authorization(transport: Transport, allowed: boolean, reason: CausalPayloads['authorization']['reason']) {
    if (transport.authorizationOutcome !== allowed) this.record('authorization', { requestId: transport.id, allowed, reason });
    transport.authorizationOutcome = allowed; return allowed;
  }
  authorize(id: string): boolean {
    this.tick(); const transport = this.transport;
    if (!transport || transport.id !== id || transport.delivered || transport.authorized) return false;
    if (transport.generation !== this.guard.generation) return this.authorization(transport, false, 'revoked');
    if (!this.enabled || !this.available) return this.authorization(transport, false, 'unavailable');
    if (!this.healthy()) return this.authorization(transport, false, 'stale');
    if (this.userBusy || !this.options.canAdmit()) return this.authorization(transport, false, 'denied');
    const request = transport.request, state = this.readCurrent();
    if (this.options.now() >= request.deadline || state.sessionId !== request.sessionId || state.epoch !== request.epoch ||
      state.intentRevision !== request.intentRevision || state.presenceRevision !== request.presenceRevision ||
      !matchesHandReadSet(request.handReadSet, state.handState) || !request.requiredTrackIds.every(track => state.trackIds.includes(track))) return this.authorization(transport, false, 'stale');
    transport.authorized = true; this.lastReason = 'authorized'; return this.authorization(transport, true, 'authorized');
  }
  async deliver(id: string, data: unknown): Promise<DecisionResult | null> { return this.settle(id, data, false); }
  async fail(id: string): Promise<DecisionResult | null> { return this.settle(id, undefined, true); }
  private async settle(id: string, data: unknown, failed: boolean): Promise<DecisionResult | null> {
    this.tick(); const transport = this.transport;
    if (!transport || transport.id !== id || transport.delivered) return null;
    transport.delivered = true; failed ? transport.reject() : transport.resolve(transport.authorized || data === null ? data : null);
    const result = await transport.done;
    const owner = transport.owner?.decisionId === result.decisionId ? transport.owner : undefined;
    this.record('decision', { requestId: result.requestId, reason: result.reason, ...(result.decisionId ? { decisionId: result.decisionId } : {}),
      ...(result.reason === 'observed' ? { mode: 'observe' as const } : {}),
      ...(result.reason === 'accepted' || result.reason === 'admission_failed' ? { mode: 'express' as const } : {}),
      ...(owner ? { actionId: owner.actionId, validUntil: owner.validUntil } : {}) });
    if (this.transport === transport) this.transport = undefined;
    this.uncertain ||= result.reason === 'transport_unknown'; this.lastReason = result.reason;
    return result;
  }
  status() {
    return { available: this.available, enabled: this.enabled, userBusy: this.userBusy, sourceValid: this.sourceValid,
      pending: this.pending.size, transport: this.transport?.id ?? null, authorized: this.transport?.authorized ?? false, owner: this.guard.owner?.actionId ?? null,
      uncertain: this.uncertain, dispatches: this.count, reason: this.lastReason };
  }
}
