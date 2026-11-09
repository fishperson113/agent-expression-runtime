import type { Observation } from '../src/core/live/types';
import type { SessionEvent } from '../src/core/live/reactive-session-types';
import type { Scenario } from './reactive-opportunities-source';

type Counts = Record<string, number>;
export type SinkOwner = { baselineRise: number; first: boolean; changed: boolean };
const increment = (values: Counts, key: string) => { values[key] = (values[key] ?? 0) + 1; };

function longestSilence(times: number[], events: number[], duration: number) {
  const edges = [0, ...times, duration];
  let result = { milliseconds: 0, from: 0, to: 0, semanticOpportunities: 0 };
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] - edges[i - 1] <= result.milliseconds) continue;
    result = { milliseconds: edges[i] - edges[i - 1], from: edges[i - 1], to: edges[i],
      semanticOpportunities: events.filter(at => at > edges[i - 1] && at <= edges[i]).length };
  }
  return result;
}

export class OpportunityMetrics {
  private semanticAt: number[] = [];
  private appliedAt: number[] = [];
  private completedAt: number[] = [];
  private revokedRequests = new Set<string>();
  rawScoreChanges = 0;
  frames = 0;
  validSourceFrames = 0;
  semanticOpportunities = 0;
  sourceEligibleOpportunities = 0;
  candidateEligible = 0;
  providerRequested = 0;
  authorizationDenied = 0;
  decisionsReturned = 0;
  admitted = 0;
  firstStateSink = 0;
  firstChangedStateSink = 0;
  phases: Counts = {};
  eventTypes: Counts = {};
  verdicts: Counts = {};
  preflightCleanupVerdicts: Counts = {};
  revocations: Counts = {};
  firstRequestRevocations: Counts = {};
  leaseRevocations: Counts = {};
  actualCancelReasons: Counts = {};
  sourceStatusFrames: Counts = {};
  observedRequestTtls = new Set<number>();
  constructor(readonly scenario: Scenario) {}
  source(at: number, snapshot: Observation, events: SessionEvent[], valid: boolean) {
    this.frames++;
    increment(this.sourceStatusFrames, snapshot.camera);
    this.semanticOpportunities += events.length;
    if (valid) { this.validSourceFrames++; this.sourceEligibleOpportunities += events.length; }
    for (const event of events) { this.semanticAt.push(at); increment(this.eventTypes, event.type); }
  }
  revoke(reason: string, request: string | null) {
    increment(this.revocations, reason);
    if (request && !this.revokedRequests.has(request)) {
      this.revokedRequests.add(request);
      increment(this.firstRequestRevocations, reason);
    }
  }
  lease(reason: string) { increment(this.leaseRevocations, reason); }
  verdict(reason: string, cleanup = false) { increment(cleanup ? this.preflightCleanupVerdicts : this.verdicts, reason); }
  execution(phase: string, at: number, cancellation?: string) {
    increment(this.phases, phase);
    if (phase === 'applied') this.appliedAt.push(at);
    if (phase === 'completed') this.completedAt.push(at);
    if (phase === 'cancelled') increment(this.actualCancelReasons, cancellation ?? 'replacement_or_stop');
  }
  sink(at: number, rise: number, owner?: SinkOwner) {
    if (!owner) return;
    if (!owner.first) { owner.first = true; this.firstStateSink++; }
    if (!owner.changed && Math.abs(rise - owner.baselineRise) > 1e-8) {
      owner.changed = true;
      this.firstChangedStateSink++;
    }
  }
  finish(duration: number, outstanding: boolean) {
    const result = { ...this.scenario, frames: this.frames, validSourceFrames: this.validSourceFrames,
      sourceValidityRatio: this.validSourceFrames / this.frames, rawScoreChanges: this.rawScoreChanges,
      semanticOpportunities: this.semanticOpportunities, sourceEligibleOpportunities: this.sourceEligibleOpportunities,
      candidateEligible: this.candidateEligible, providerRequested: this.providerRequested, authorizationDenied: this.authorizationDenied,
      decisionsReturned: this.decisionsReturned, admitted: this.admitted, firstStateSink: this.firstStateSink,
      firstChangedStateSink: this.firstChangedStateSink, phases: this.phases, eventTypes: this.eventTypes,
      verdicts: this.verdicts, preflightCleanupVerdicts: this.preflightCleanupVerdicts, revocations: this.revocations,
      firstRequestRevocations: this.firstRequestRevocations, leaseRevocations: this.leaseRevocations,
      actualCancelReasons: this.actualCancelReasons, sourceStatusFrames: this.sourceStatusFrames,
      observedRequestTtlsMs: [...this.observedRequestTtls], outstandingAtEnd: Number(outstanding),
      actualGpuFramesMeasured: false, longestAppliedSilence: longestSilence(this.appliedAt, this.semanticAt, duration),
      longestCompletedSilence: longestSilence(this.completedAt, this.semanticAt, duration) };
    return structuredClone(result);
  }
}

export type OpportunityRow = ReturnType<OpportunityMetrics['finish']>;
export function assertAccounting(row: OpportunityRow) {
  const sum = (values: Counts) => Object.values(values).reduce((total, value) => total + value, 0);
  const valid = row.providerRequested === row.decisionsReturned + row.outstandingAtEnd &&
    row.decisionsReturned === sum(row.verdicts) && row.semanticOpportunities === sum(row.eventTypes) &&
    row.frames === sum(row.sourceStatusFrames) && row.validSourceFrames <= row.frames &&
    row.admitted <= row.decisionsReturned && (row.phases.applied ?? 0) <= row.admitted &&
    (row.phases.completed ?? 0) + (row.phases.cancelled ?? 0) <= row.admitted &&
    row.firstChangedStateSink <= row.firstStateSink && row.firstStateSink <= row.admitted;
  if (!valid) throw Error('diagnostic_harness_accounting');
}
