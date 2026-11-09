import { freezeSemanticSnapshot, freezePrerequisites, knownPrerequisites, matchesCriticalState, matchesPrerequisites, validateBriefV2Body } from './decision-contract';
import { freezeHandReadSet } from './decision-types';
import { LiveCompiler } from './compiler';
import { strictObject } from './observation';
import type { DecisionAdmission, DecisionResult, ReactiveAdapter, ReactiveRequest, ReactiveState } from './decision-types';

const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function freezeRequest(value: ReactiveRequest): ReactiveRequest {
  const fields = ['schemaVersion', 'sessionId', 'epoch', 'requestId', 'intentRevision', 'deadline', 'requiredTrackIds'];
  if (Object.hasOwn(value, 'presenceRevision')) fields.push('presenceRevision');
  if (Object.hasOwn(value, 'handReadSet')) fields.push('handReadSet');
  if (value.schemaVersion === 2) fields.push('semanticSnapshot');
  strictObject(value, fields);
  if (Object.hasOwn(value, 'presenceRevision') && (!Number.isSafeInteger(value.presenceRevision) || value.presenceRevision! < 0)) throw Error('request');
  if (![1, 2].includes(value.schemaVersion) || value.schemaVersion === 2 && !Number.isSafeInteger(value.presenceRevision) || ![value.sessionId, value.epoch, value.requestId].every(id) ||
    !Number.isSafeInteger(value.intentRevision) || value.intentRevision < 0 || !time(value.deadline) ||
    !Array.isArray(value.requiredTrackIds) || value.requiredTrackIds.length > 16 ||
    !value.requiredTrackIds.every(id) || new Set(value.requiredTrackIds).size !== value.requiredTrackIds.length) throw Error('request');
  return Object.freeze({ ...value, ...(value.schemaVersion === 2 ? { semanticSnapshot: freezeSemanticSnapshot(value.semanticSnapshot) } : {}), ...(Object.hasOwn(value, 'handReadSet') ? { handReadSet: freezeHandReadSet(value.handReadSet) } : {}), requiredTrackIds: Object.freeze([...value.requiredTrackIds]) });
}
function decision(value: unknown, request: ReactiveRequest) {
  let object = strictObject(value, ['schemaVersion', 'requestId', 'decisionId', 'mode', 'validUntil', 'action', ...(request.schemaVersion === 2 ? ['prerequisites'] : [])]);
  if (object.schemaVersion !== request.schemaVersion || object.requestId !== request.requestId || !id(object.decisionId) ||
    !time(object.validUntil) || object.validUntil > request.deadline) throw Error('decision');
  if (request.schemaVersion === 2) { object = { ...object, prerequisites: freezePrerequisites(object.prerequisites) }; if (!knownPrerequisites(request, object.prerequisites)) throw Error('prerequisites_unknown'); }
  if (object.mode === 'observe' && object.action === null) return object;
  if (object.mode !== 'express') throw Error('mode');
  const action = strictObject(object.action, ['actionId', 'body']);
  if (request.schemaVersion === 2) validateBriefV2Body(action.body);
  if (!id(action.actionId)) throw Error('action');
  return object;
}

/** Offline track-membership and optional semantic read-sets; no production provider/renderer is connected.
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
    return generation === this.generation && time(now) && now < until && now < request.deadline && matchesCriticalState(request, state);
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
    let parsed: Record<string, any> | undefined, compiled, duration = 0;
    const result = (reason: DecisionResult['reason'], decisionId?: string): DecisionResult => ({ reason, requestId: request.requestId, decisionId,
      ...(request.schemaVersion === 2 && parsed && reason !== 'invalid_decision' ? { decisionVersion: 2 as const, prerequisites: parsed.prerequisites } : {}) });
    try {
      parsed = decision(output, request);
      if (this.decisions.has(parsed.decisionId) || (parsed.action && this.actions.has(parsed.action.actionId))) return result('duplicate');
      if (parsed.mode === 'express') compiled = this.compiler.compile({ v: 1, epoch: request.epoch, seq: this.requests.size,
        kind: 'program', track: 'body', policy: 'replace', body: structuredClone(parsed.action.body) }, this.now());
    } catch { return result('invalid_decision'); }
    if (request.schemaVersion === 2 && compiled) {
      if (compiled.program.kind !== 'program' || !Number.isFinite(compiled.program.duration) || compiled.program.duration < 200 || compiled.program.duration > 1000) return result('invalid_decision');
      duration = compiled.program.duration;
    }
    if (!this.current(request, generation, parsed.validUntil) || !matchesPrerequisites(request, this.read(), parsed.prerequisites ?? [])) return result('stale', parsed.decisionId);
    this.decisions.add(parsed.decisionId);
    if (!compiled) return result('observed', parsed.decisionId);
    this.actions.add(parsed.action.actionId);
    const admittedAt = this.now();
    if (!time(admittedAt) || admittedAt >= request.deadline || admittedAt >= parsed.validUntil) return result('stale', parsed.decisionId);
    const ownership = Object.freeze({ requestId: request.requestId, decisionId: parsed.decisionId, actionId: parsed.action.actionId, validUntil: parsed.validUntil,
      ...(request.schemaVersion === 2 ? { decisionVersion: 2 as const, prerequisites: parsed.prerequisites, executionValidUntil: admittedAt + duration + 100 } : {}) });
    try { admit(compiled, ownership); }
    catch { return result('admission_failed', parsed.decisionId); }
    return { ...result('accepted', parsed.decisionId), ...(request.schemaVersion === 2 ? { executionValidUntil: ownership.executionValidUntil } : {}) };
  }
}
