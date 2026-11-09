import { ReactiveSession } from '../src/core/live/reactive-session';
import { Scheduler } from '../src/core/runtime/scheduler';
import { LiveCompiler } from '../src/core/live/compiler';
import { faceProgram } from '../src/core/live/face';
import type { ReactiveRequest } from '../src/core/live/decision-types';
import { OpportunitySource, stepMs, wallOriginMs, type Scenario } from './reactive-opportunities-source';
import { OpportunityMetrics, assertAccounting, type SinkOwner } from './reactive-opportunities-metrics';

type Clock = { now: number };
type Execution = { owner?: string; sink?: SinkOwner; cancelling?: string; origins: WeakSet<object> };
type Pending = { request: ReactiveRequest; due: number };
type Run = ReturnType<typeof createRun>;

function createScheduler(clock: Clock, metrics: OpportunityMetrics, execution: Execution) {
  const scheduler = new Scheduler({ now: () => clock.now }, {
    apply: state => metrics.sink(clock.now, state.rise as number, execution.sink), dispose() {}
  }, { count() {} }, (phase, ir) => {
    if (execution.origins.has(ir)) metrics.execution(phase, clock.now, execution.cancelling);
  }, 64);
  scheduler.cancel('qa_epoch', false);
  return scheduler;
}

function createSession(clock: Clock, metrics: OpportunityMetrics, execution: Execution, scheduler: Scheduler) {
  let id = 0;
  const ambient = new LiveCompiler();
  return new ReactiveSession({ now: () => clock.now, wallNow: () => wallOriginMs + clock.now,
    epoch: () => 'qa_epoch', id: () => 'r' + ++id, canAdmit: () => !scheduler.busy,
    admit: (compiled, owner) => {
      scheduler.cancel('qa_epoch', false);
      execution.origins.add(compiled.program);
      execution.owner = owner.actionId;
      if (scheduler.admit(compiled.program) !== 'accepted') throw Error('diagnostic_harness_admission');
      execution.sink = { baselineRise: scheduler.state.rise as number, first: false, changed: false };
      metrics.admitted++;
    }, cancel: (owner, reason) => {
      metrics.lease(reason);
      if (execution.owner !== owner.actionId) return;
      execution.owner = undefined;
      execution.sink = undefined;
      execution.cancelling = reason;
      scheduler.cancel('qa_epoch', false);
      execution.cancelling = undefined;
      scheduler.admit(ambient.compile({ v: 1, epoch: 'qa_epoch', seq: 0, kind: 'program', track: 'body',
        policy: 'replace', body: faceProgram(600) }, clock.now).program);
    } });
}

function createRun(scenario: Scenario) {
  const clock = { now: 0 }, metrics = new OpportunityMetrics(scenario);
  const execution: Execution = { origins: new WeakSet() };
  const scheduler = createScheduler(clock, metrics, execution);
  const session = createSession(clock, metrics, execution, scheduler);
  const observed = session as unknown as { revoke: (reason: string) => void };
  const revoke = observed.revoke.bind(session);
  observed.revoke = reason => { metrics.revoke(reason, session.status().transport); revoke(reason); };
  session.configure(true);
  session.enable(true);
  return { clock, metrics, scheduler, session, source: new OpportunitySource(scenario), pending: undefined as Pending | undefined };
}

async function receive(run: Run) {
  if (!run.pending || run.pending.due > run.clock.now) return;
  const { request } = run.pending;
  run.pending = undefined;
  run.metrics.decisionsReturned++;
  const result = await run.session.deliver(request.requestId, { schemaVersion: 1, requestId: request.requestId,
    decisionId: 'd' + request.requestId, mode: 'express', validUntil: request.deadline,
    action: { actionId: 'a' + request.requestId, body: { type: 'shapeQuality', rise: 0.15, advance: 0,
      grow: 1, spread: 1, durationMs: 600 } } });
  run.metrics.verdict(result?.reason ?? 'missing');
}

async function request(run: Run) {
  const candidate = run.session.takeRequest();
  if (!candidate) return;
  run.metrics.candidateEligible++;
  if (!run.session.authorize(candidate.request.requestId)) {
    run.metrics.authorizationDenied++;
    const result = await run.session.deliver(candidate.request.requestId, null);
    run.metrics.verdict(result?.reason ?? 'missing', true);
    return;
  }
  run.metrics.providerRequested++;
  run.metrics.observedRequestTtls.add(candidate.request.deadline - run.clock.now);
  run.pending = { request: candidate.request, due: run.clock.now + run.metrics.scenario.latency };
}

export async function runOpportunityScenario(scenario: Scenario, durationMs: number, pollMs = 50) {
  const run = createRun(scenario);
  try {
    for (run.clock.now = 0; run.clock.now < durationMs; run.clock.now += stepMs) {
      const { snapshot, events } = run.source.frame(run.clock.now);
      run.session.observe(snapshot, events);
      run.session.tick();
      run.metrics.source(run.clock.now, snapshot, events, run.session.status().sourceValid);
      if (scenario.mode === 'user-busy') run.session.setUserBusy(run.clock.now % 30000 >= 10000 && run.clock.now % 30000 < 15000);
      await receive(run);
      run.scheduler.tick();
      if (run.clock.now % pollMs === 0) await request(run);
    }
    run.clock.now = durationMs;
    run.session.tick();
    await receive(run);
    run.scheduler.tick();
    run.metrics.rawScoreChanges = run.source.rawChanges;
    const row = run.metrics.finish(durationMs, !!run.pending);
    assertAccounting(row);
    return row;
  } finally { run.scheduler.dispose(); }
}

export async function runOpportunityMatrix(quick: boolean, progress: (count: number) => void = () => {}) {
  const durationMs = quick ? 120000 : 1200000;
  const rates = quick ? [0, 0.5, 2, 4] : [0, 0.05, 0.25, 0.5, 1, 2, 4];
  const latencies = quick ? [100, 2000, 4900, 5500] : [100, 500, 1000, 2000, 4000, 4500, 4900, 5500, 8000];
  const rows = [];
  for (const rate of rates) for (const latency of latencies) {
    rows.push(await runOpportunityScenario({ rate, latency, seed: 0, mode: 'fresh' }, durationMs));
    progress(rows.length);
  }
  if (!quick) {
    for (const rate of [0.25, 0.5, 1, 2]) for (const latency of [500, 2000, 4000])
      rows.push(await runOpportunityScenario({ rate, latency, seed: 9011, mode: 'fresh' }, durationMs));
    for (const mode of ['source-loss', 'user-busy'] as const)
      rows.push(await runOpportunityScenario({ rate: 0.5, latency: 2000, seed: 0, mode }, durationMs));
  }
  const controls = [];
  for (const rate of [0, 0.5]) controls.push(await runOpportunityScenario({ rate, latency: 2000, seed: 0, mode: 'fresh' }, durationMs, 100));
  return { durationMs, rows, controls };
}
