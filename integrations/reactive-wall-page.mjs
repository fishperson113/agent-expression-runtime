import { FaceObservations } from '/src/live/observation.ts';
import { ReactiveSession } from '/src/core/live/reactive-session.ts';
import { LiveBody } from '/src/live/body.ts';

const phaseNames = ['quiet', 'active'];
const fresh = () => ({ sourceFrames: 0, validSourceFrames: 0, rawScoreChanges: 0, semanticOpportunities: 0, sourceValidSemanticOpportunities: 0,
  brokerPollCallbacks: 0, takeRequestCalls: 0, candidates: 0, authorized: 0, authorizationDenied: 0, admissionCallbacks: 0,
  rendererApplyCalls: 0, rendererFrameAdvances: 0, contextLostCalls: 0, eventTypes: {}, decisions: {}, revocations: {}, firstRequestRevocations: {}, leaseRevocations: {},
  ownedTraceEvents: {}, uniqueOwnedRequests: {}, latency: {}, semanticAt: [], appliedAt: [], completedAt: [] });
const phases = { quiet: fresh(), active: fresh() }, epoch = '354d6420-1111-4111-8111-901100000001';
const observations = new FaceObservations('qa_wall_synthetic'), cohorts = new Map(), sourceEvents = new Map(), firstRevoked = new Set(), unique = new Map();
let running = false, ended = false, startAt = 0, wallAt = 0, quietMs = 0, activeMs = 0, inputTimer, seq = 0, previousScore = 0, previousSource;
let aggregateOverflow = 0, mediaCalls = 0;
const add = (object, key) => { object[key] = (object[key] ?? 0) + 1; };
function histogram() { return { count: 0, sum: 0, min: Infinity, max: 0, bins: {} }; }
function sample(stat, value) {
  if (!Number.isFinite(value)) return;
  stat.count++; stat.sum += value; stat.min = Math.min(stat.min, value); stat.max = Math.max(stat.max, value);
  add(stat.bins, String(Math.min(5001, Math.floor(Math.max(0, value)))));
}
function summary(stat) {
  if (!stat?.count) return { count: 0, min: null, max: null, mean: null, p50: null, p95: null };
  const percentile = ratio => { let count = 0; for (const [bin, n] of Object.entries(stat.bins).sort((a, b) => +a[0] - +b[0])) {
    count += n; if (count >= Math.ceil(stat.count * ratio)) return +bin;
  } return stat.max; };
  return { count: stat.count, min: stat.min, max: stat.max, mean: stat.sum / stat.count, p50: percentile(0.5), p95: percentile(0.95), overflowBinAboveMs: 5000 };
}
function phaseAt(at = performance.now()) { return at - startAt < quietMs ? 'quiet' : 'active'; }
function push(array, value) { if (array.length < 4096) array.push(value); else aggregateOverflow++; }
function cohort(id) { return cohorts.get(id); }
const sourceGap = histogram(), body = new LiveBody(document.querySelector('canvas'), () => {});
body.epoch(epoch, true);
const traceRecord = body.trace.record.bind(body.trace);
body.trace.record = (...args) => {
  const [, phase, at, , , owner] = args;
  const request = owner?.origin === 'reactive' ? cohort(owner.requestId) : null;
  if (running && request && owner.decisionId && owner.actionId) {
    const data = phases[request.phase]; add(data.ownedTraceEvents, phase);
    const key = owner.requestId + ':' + phase;
    if (!unique.has(key)) {
      if (unique.size >= 2048) aggregateOverflow++;
      else {
        unique.set(key, true); add(data.uniqueOwnedRequests, phase);
        sample(data.latency[phase] ??= histogram(), at - request.opportunityAt);
        if (phase === 'applied') push(data.appliedAt, at - startAt);
        if (phase === 'completed') push(data.completedAt, at - startAt);
      }
    }
  }
  return traceRecord(...args);
};
const renderApply = body.renderer.apply.bind(body.renderer);
body.renderer.apply = (state, at) => {
  const before = body.renderer.renderSnapshot.frame; const result = renderApply(state, at);
  if (running) {
    const data = phases[phaseAt()], after = body.renderer.renderSnapshot;
    data.rendererApplyCalls++; data.rendererFrameAdvances += Math.max(0, after.frame - before);
    if (after.contextLost) data.contextLostCalls++;
  }
  return result;
};
const reactive = new ReactiveSession({ now: () => performance.now(), wallNow: () => Date.now(), epoch: () => body.scheduler.epoch,
  id: () => crypto.randomUUID(), canAdmit: () => !document.hidden && body.canReactive(),
  admit: (compiled, owner) => { body.admitReactive(compiled, owner); if (running && cohort(owner.requestId)) phases[cohort(owner.requestId).phase].admissionCallbacks++; },
  cancel: (owner, reason) => { if (running && cohort(owner.requestId)) add(phases[cohort(owner.requestId).phase].leaseRevocations, reason); body.cancelReactive(owner, reason); } });
body.attachReactive(reactive);
const revoke = reactive.revoke.bind(reactive);
reactive.revoke = reason => {
  if (running) {
    add(phases[phaseAt()].revocations, reason);
    const id = reactive.status().transport, request = cohort(id);
    if (id && request && !firstRevoked.has(id)) { firstRevoked.add(id); add(phases[request.phase].firstRequestRevocations, reason); }
  }
  return revoke(reason);
};
if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { mediaCalls++; throw Error('probe_media_forbidden'); };
const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function input() {
  if (!running) return;
  const now = performance.now(), phase = phaseAt(now), data = phases[phase], activeElapsed = Math.max(0, now - startAt - quietMs);
  const score = phase === 'active' ? Math.floor(activeElapsed / 2000) % 2 : 0;
  if (score !== previousScore) { data.rawScoreChanges++; previousScore = score; }
  if (previousSource !== undefined) sample(sourceGap, now - previousSource); previousSource = now;
  landmarks[1].x = 0.5 + 0.2 * Math.sin((now - startAt) / 1000);
  const events = observations.update({ landmarks, matrix, scores: { mouthSmileLeft: score, mouthSmileRight: score }, durationMs: 0, delegate: 'synthetic' }, Date.now())
    .map(event => ({ ...event, seq: ++seq }));
  for (const event of events) {
    data.semanticOpportunities++; add(data.eventTypes, event.type); push(data.semanticAt, now - startAt);
    sourceEvents.set(event.seq, { phase, at: now }); if (sourceEvents.size > 64) sourceEvents.delete(sourceEvents.keys().next().value);
  }
  body.observe(observations.snapshot); reactive.observe(observations.snapshot, events); reactive.tick();
  data.sourceFrames++; if (reactive.status().sourceValid) { data.validSourceFrames++; data.sourceValidSemanticOpportunities += events.length; }
}
function silence(times, opportunities, from, to) {
  const edges = [from, ...times.filter(at => at >= from && at <= to), to].sort((a, b) => a - b);
  let best = { milliseconds: 0, from, to: from, semanticOpportunities: 0 };
  for (let i = 1; i < edges.length; i++) if (edges[i] - edges[i - 1] > best.milliseconds)
    best = { milliseconds: edges[i] - edges[i - 1], from: edges[i - 1], to: edges[i], semanticOpportunities: opportunities.filter(at => at > edges[i - 1] && at <= edges[i]).length };
  return best;
}
function report() {
  const elapsedMs = performance.now() - startAt, result = {};
  for (const name of phaseNames) {
    const data = phases[name], from = name === 'quiet' ? 0 : quietMs, to = name === 'quiet' ? Math.min(elapsedMs, quietMs) : elapsedMs;
    const { semanticAt, appliedAt, completedAt, latency, ...counts } = data;
    result[name] = { ...counts, elapsedMs: Math.max(0, to - from), sourceValidityRatio: data.sourceFrames ? data.validSourceFrames / data.sourceFrames : null,
      opportunityToOwnedTraceMs: Object.fromEntries(Object.entries(latency).map(([key, value]) => [key, summary(value)])),
      longestAppliedSilence: silence(appliedAt, semanticAt, from, to), longestCompletedSilence: silence(completedAt, semanticAt, from, to) };
  }
  const status = reactive.status(), owner = status.transport && cohort(status.transport);
  return { elapsedMs, wallStart: wallAt, plannedQuietMs: quietMs, plannedActiveMs: activeMs, phases: result, mediaCalls, aggregateOverflow,
    sourceGapMs: summary(sourceGap), sourceNominalHz: 20, activeNominalRawHz: 0.5, activeNominalTransitionsBeforeMeasuredEnd: Math.floor(Math.max(0, elapsedMs - quietMs) / 2000),
    sourceDefinition: 'Uniform synthetic478 landmarks, identity head matrix, x=.5+.2sin(elapsed/1000), raw bilateral smile0/1 each2000ms after active phase starts; real debounce.',
    censoredAtEnd: { browserTransport: Number(!!status.transport), transportCohort: owner?.phase ?? null, leaseOwner: Number(!!status.owner), schedulerBusy: body.scheduler.busy },
    finalStatus: { sourceValid: status.sourceValid, uncertain: status.uncertain, dispatches: status.dispatches, reason: status.reason,
      queueDepth: body.scheduler.queueDepth, userGeometryLocked: body.userSceneOwned, contextLost: body.renderer.renderSnapshot.contextLost,
      particles: body.renderer.count, documentHidden: document.hidden } };
}
window.fischLive = {
  activity: activity => { body.activity(activity.turn); body.output = activity.output ?? 0; }, logActivity: () => {},
  configureReactive: available => { if (running) { phases[phaseAt()].brokerPollCallbacks++; reactive.configure(available); } },
  setReactiveUserBusy: busy => reactive.setUserBusy(busy), reactiveUserIntent: () => reactive.userIntent(),
  takeReactiveRequest: () => {
    if (!running) return null;
    phases[phaseAt()].takeRequestCalls++; const candidate = reactive.takeRequest();
    if (candidate) {
      const latest = candidate.observationWindow.events.at(-1), event = sourceEvents.get(latest.id) ?? { phase: phaseAt(), at: performance.now() };
      cohorts.set(candidate.request.requestId, { phase: event.phase, opportunityAt: event.at }); phases[event.phase].candidates++;
    }
    return candidate;
  },
  authorizeReactiveRequest: id => { const allowed = reactive.authorize(id); if (running && cohort(id)) phases[cohort(id).phase][allowed ? 'authorized' : 'authorizationDenied']++; return allowed; },
  deliverReactiveDecision: async (id, value) => { const result = await reactive.deliver(id, value); if (running && cohort(id)) add(phases[cohort(id).phase].decisions, result?.reason ?? 'missing'); return result; },
  failReactiveDecision: async id => { const result = await reactive.fail(id); if (running && cohort(id)) add(phases[cohort(id).phase].decisions, result?.reason ?? 'missing'); return result; }
};
window.wallProbe = {
  ready: true,
  start: plan => { if (running || ended) throw Error('probe_once'); quietMs = plan.quietMs; activeMs = plan.activeMs;
    startAt = performance.now(); wallAt = Date.now(); running = true; reactive.configure(true); reactive.enable(true); input(); inputTimer = setInterval(input, 50);
    return { browserStart: startAt, wallStart: wallAt }; },
  peek: () => report(),
  end: () => { const result = report(); running = false; ended = true; clearInterval(inputTimer); return result; },
  dispose: () => { running = false; clearInterval(inputTimer); body.dispose(); }
};
