import { LiveCompiler } from './compiler';
import { strictObject } from './observation';
import type { DecisionAdmission, DecisionResult, ReactiveAdapter, ReactiveRequest, ReactiveState } from './decision-types';

const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function freezeRequest(value: ReactiveRequest): ReactiveRequest {
  const fields = ['schemaVersion', 'sessionId', 'epoch', 'requestId', 'intentRevision', 'deadline', 'requiredTrackIds'];
  if (Object.hasOwn(value, 'presenceRevision')) fields.push('presenceRevision');
  strictObject(value, fields);
  if (Object.hasOwn(value, 'presenceRevision') && (!Number.isSafeInteger(value.presenceRevision) || value.presenceRevision! < 0)) throw Error('request');
  if (value.schemaVersion !== 1 || ![value.sessionId, value.epoch, value.requestId].every(id) ||
    !Number.isSafeInteger(value.intentRevision) || value.intentRevision < 0 || !time(value.deadline) ||
    !Array.isArray(value.requiredTrackIds) || value.requiredTrackIds.length > 16 ||
    !value.requiredTrackIds.every(id) || new Set(value.requiredTrackIds).size !== value.requiredTrackIds.length) throw Error('request');
  return Object.freeze({ ...value, requiredTrackIds: Object.freeze([...value.requiredTrackIds]) });
}
function decision(value: unknown, request: ReactiveRequest) {
  const object = strictObject(value, ['schemaVersion', 'requestId', 'decisionId', 'mode', 'validUntil', 'action']);
  if (object.schemaVersion !== 1 || object.requestId !== request.requestId || !id(object.decisionId) ||
    !time(object.validUntil) || object.validUntil > request.deadline) throw Error('decision');
  if (object.mode === 'observe' && object.action === null) return object;
  if (object.mode !== 'express') throw Error('mode');
  const action = strictObject(object.action, ['actionId', 'body']);
  if (!id(action.actionId)) throw Error('action');
  return object;
}

/** Offline track-membership and optional presence-revision read-set; no production provider/renderer is connected.
 * A host retains at most 256 receipts for its lifetime; capacity requires a new host.
 * Admission is synchronous. Execution-time leases and per-tick validation belong to the caller. */
export class ReactiveDecisionHost {
  private active?: AbortController;
  private generation = 0;
  private transportSerial = 0;
  private uncertainTransport?: number;
  private requests = new Set<string>();
  private decisions = new Set<string>();
  private actions = new Set<string>();
  constructor(private read: () => ReactiveState, private now: () => number, private compiler = new LiveCompiler()) {}
  confirmTransportSettled(token: number) {
    if (token !== this.uncertainTransport) return false;
    this.uncertainTransport = undefined; return true;
  }
  revoke() { this.generation++; this.active?.abort(); }
  private current(request: ReactiveRequest, generation: number, until = request.deadline) {
    const state = this.read(), now = this.now();
    return generation === this.generation && time(now) && now < until && now < request.deadline &&
      state.sessionId === request.sessionId && state.epoch === request.epoch && state.intentRevision === request.intentRevision &&
      (request.presenceRevision === undefined || state.presenceRevision === request.presenceRevision) &&
      request.requiredTrackIds.every(track => state.trackIds.includes(track));
  }
  async run(value: ReactiveRequest, adapter: ReactiveAdapter, admit: DecisionAdmission): Promise<DecisionResult> {
    let request: ReactiveRequest;
    try { request = freezeRequest(value); } catch { return { reason: 'invalid_request', requestId: '' }; }
    const result = (reason: DecisionResult['reason'], decisionId?: string): DecisionResult => ({ reason, requestId: request.requestId, decisionId });
    if (this.requests.has(request.requestId)) return result('duplicate');
    if (this.active || this.uncertainTransport !== undefined) return result('busy');
    if (this.requests.size >= 256) return result('capacity');
    const generation = this.generation;
    if (!this.current(request, generation)) return result('stale');
    const controller = new AbortController(); this.active = controller; this.requests.add(request.requestId);
    try {
      const output = await adapter.decide(request, controller.signal);
      if (generation !== this.generation) return result('revoked');
      if (!this.current(request, generation)) return result('stale');
      return this.accept(output, request, generation, admit);
    } catch {
      this.uncertainTransport = ++this.transportSerial;
      return { ...result('transport_unknown'), transportToken: this.uncertainTransport };
    }
    finally { if (this.active === controller) this.active = undefined; }
  }
  private accept(output: unknown, request: ReactiveRequest, generation: number, admit: DecisionAdmission): DecisionResult {
    const result = (reason: DecisionResult['reason'], decisionId?: string): DecisionResult => ({ reason, requestId: request.requestId, decisionId });
    let parsed, compiled;
    try {
      parsed = decision(output, request);
      if (this.decisions.has(parsed.decisionId) || (parsed.action && this.actions.has(parsed.action.actionId))) return result('duplicate');
      if (parsed.mode === 'express') compiled = this.compiler.compile({ v: 1, epoch: request.epoch, seq: this.requests.size,
        kind: 'program', track: 'body', policy: 'replace', body: structuredClone(parsed.action.body) }, this.now());
    } catch { return result('invalid_decision'); }
    if (!this.current(request, generation, parsed.validUntil)) return result('stale', parsed.decisionId);
    this.decisions.add(parsed.decisionId);
    if (!compiled) return result('observed', parsed.decisionId);
    this.actions.add(parsed.action.actionId);
    try { admit(compiled, Object.freeze({ requestId: request.requestId, decisionId: parsed.decisionId,
      actionId: parsed.action.actionId, validUntil: parsed.validUntil })); }
    catch { return result('admission_failed', parsed.decisionId); }
    return result('accepted', parsed.decisionId);
  }
}
