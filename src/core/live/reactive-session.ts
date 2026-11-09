import { ReactiveDecisionHost } from './decision-host';
import { ReactiveLeaseGuard, type LeaseRevokeReason } from './reactive-lease';
import { validateObservation } from './observation';
import type { DecisionResult, ReactiveRequest, ReactiveState } from './decision-types';
import type { Observation } from './types';
import type { ReactiveWindow, SessionEvent, SessionOptions } from './reactive-session-types';

const faceEvents = new Set(['user_arrived', 'user_left', 'looked_away', 'looked_back', 'expression_changed']);
const revokeReasons: Record<string, LeaseRevokeReason> = { presence_changed: 'presence_changed', session_changed: 'session_changed',
  epoch_changed: 'epoch_changed', semantic_changed: 'semantic_changed', user_intent: 'intent_changed', user_busy: 'intent_changed', deadline: 'expired', source_expired: 'expired', track_lost: 'track_lost' };
const key = (type: string) => type.startsWith('user_') ? 'presence' : type.startsWith('looked_') ? 'orientation' : 'expression';
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
type Transport = { id: string; request: ReactiveRequest; generation: number; authorized: boolean; delivered: boolean; done: Promise<DecisionResult>;
  resolve: (value: unknown) => void; reject: () => void };

/** Pure coordinator. It never contacts a provider or writes to a renderer directly. */
export class ReactiveSession {
  private available = false;
  private enabled = false;
  private userBusy = false;
  private snapshot?: Observation;
  private history: Observation[] = [];
  private pending = new Map<string, SessionEvent>();
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
    this.guard = new ReactiveLeaseGuard(() => this.readCurrent(), options.now, options.cancel);
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
  private clearSource(reason: string) {
    this.revoke(reason); this.snapshot = undefined; this.history = []; this.seen = -1;
    this.presenceRevision++; this.sourceValid = false;
  }
  private revoke(reason: string) {
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
      intentRevision: this.intentRevision, presenceRevision: this.presenceRevision, trackIds: this.tracks() };
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
    this.events(events);
  }
  private events(events: SessionEvent[]) {
    if (!Array.isArray(events)) { this.revoke('invalid_events'); return; }
    for (const event of events.slice(-8)) {
      if (!event || !Number.isSafeInteger(event.seq) || event.seq < 0 || event.seq <= this.seen) continue;
      this.seen = event.seq;
      if (!this.enabled || !this.available || !this.sourceValid || !faceEvents.has(event.type) || !this.fresh(event.at, 5000)) continue;
      if (this.guard.owner || this.transport?.generation === this.guard.generation) this.revoke('semantic_changed');
      if (!this.pending.size) this.firstAt = this.options.now();
      this.pending.set(key(event.type), { type: event.type, seq: event.seq, at: event.at });
    }
  }
  tick() {
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
    this.ids.add(requestId);
    const request: ReactiveRequest = frozen({ schemaVersion: 1, sessionId: this.snapshot!.sessionId, epoch: this.options.epoch(),
      requestId, intentRevision: this.intentRevision, presenceRevision: this.presenceRevision,
      deadline: now + 5000, requiredTrackIds: this.tracks() });
    const observationWindow: ReactiveWindow = frozen({ schemaVersion: 1, request,
      events: [...this.pending.values()].map(event => ({ id: event.seq, type: event.type, at: event.at })), observations: structuredClone(this.history) });
    this.pending.clear(); this.lastStart = now; this.starts.push(now); this.count++;
    this.dispatch(request); return { request, observationWindow };
  }
  private dispatch(request: ReactiveRequest) {
    let resolve!: (value: unknown) => void, reject!: () => void;
    const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = () => no(Error('transport_unknown')); });
    const generation = this.guard.generation;
    const done = this.host.run(request, { decide: () => promise }, (compiled, owner) => {
      if (!this.enabled || !this.available || !this.healthy() || this.userBusy || !this.options.canAdmit() || !this.guard.acquire(request, owner, generation)) throw Error('admission_revoked');
      try { this.options.admit(compiled, owner); }
      catch (error) { this.guard.revoke(); throw error; }
    });
    this.transport = { id: request.requestId, request, generation, authorized: false, delivered: false, resolve, reject, done };
  }
  authorize(id: string): boolean {
    this.tick(); const transport = this.transport;
    if (!transport || transport.id !== id || transport.delivered || transport.authorized || transport.generation !== this.guard.generation ||
      !this.enabled || !this.available || !this.healthy() || this.userBusy || !this.options.canAdmit()) return false;
    const request = transport.request, state = this.readCurrent();
    if (this.options.now() >= request.deadline || state.sessionId !== request.sessionId || state.epoch !== request.epoch ||
      state.intentRevision !== request.intentRevision || state.presenceRevision !== request.presenceRevision ||
      !request.requiredTrackIds.every(track => state.trackIds.includes(track))) return false;
    transport.authorized = true; this.lastReason = 'authorized'; return true;
  }
  async deliver(id: string, data: unknown): Promise<DecisionResult | null> { return this.settle(id, data, false); }
  async fail(id: string): Promise<DecisionResult | null> { return this.settle(id, undefined, true); }
  private async settle(id: string, data: unknown, failed: boolean): Promise<DecisionResult | null> {
    this.tick(); const transport = this.transport;
    if (!transport || transport.id !== id || transport.delivered) return null;
    transport.delivered = true; failed ? transport.reject() : transport.resolve(transport.authorized || data === null ? data : null);
    const result = await transport.done;
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
