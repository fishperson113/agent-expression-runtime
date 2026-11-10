import { expect, it } from 'vitest';
import { ClassifierShadowAdapter, classifierLabels, parseClassifierPrediction } from '../integrations/classifier-shadow.mjs';

const window = () => ({ schemaVersion: 1, request: { schemaVersion: 2, sessionId: 's', epoch: 'e', requestId: 'r',
  intentRevision: 1, presenceRevision: 1, deadline: 5000, requiredTrackIds: ['hand-a'],
  semanticSnapshot: { orientation: null, expression: null, handMotion: 2, handIdentity: 1 },
  handReadSet: { stateRevision: 1, sourceGeneration: 1, primaryTrackId: 'hand-a' } },
  events: [{ id: 1, type: 'expression_changed', at: 100 }], observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100,
    camera: 'absent', turn: 'idle', summary: 'LOCAL_ONLY', user: { present: false, quality: { score: 0, basis: 'unavailable' },
      position: null, head: null, facingScreen: null, expression: null, mouthMoving: null } }] });
const prediction = (label = 'attend', confidence = 0.9) => JSON.stringify({ schemaVersion: 1, label,
  scores: Object.fromEntries(classifierLabels.map(key => [key, key === label ? confidence : (1 - confidence) / 4])) });
const options = extra => ({ modelId: 'convaiinnovations/laya', modelRevision: 'pinned-revision',
  minConfidence: 0.75, minMargin: 0.2, now: () => 1000, isCurrent: () => true, ...extra });
it('binds immutable host provenance without accepting model-owned authority or producing executable effects', () => {
  const adapter = new ClassifierShadowAdapter(options()), original = window(), binding = adapter.bind(original);
  original.request.intentRevision = 99;
  expect(binding.request.intentRevision).toBe(1); expect(Object.isFrozen(binding.request.handReadSet)).toBe(true);
  expect(adapter.complete(binding, prediction())).toMatchObject({ status: 'shadow', label: 'attend', binding });
  expect(adapter.complete(binding, prediction()).reason).toBe('binding_unknown_or_completed');
  expect(Object.keys(adapter.complete(binding, prediction()))).not.toContain('action');
  const injected = JSON.parse(prediction()); injected.requestId = 'forged';
  expect(() => parseClassifierPrediction(JSON.stringify(injected))).toThrow('classifier_prediction_invalid');
});
it('rejects malformed, incomplete, nonfinite, unnormalized and contradictory predictions', () => {
  for (const text of ['', 'x'.repeat(4097), '{}', prediction('unknown'), prediction('attend', 1.1)])
    expect(() => parseClassifierPrediction(text)).toThrow();
  for (const modify of [p => { delete p.scores.observe; }, p => { p.scores.observe = null; },
    p => { p.scores.observe = 1; }, p => { p.label = 'observe'; }, p => { p.schemaVersion = 2; }]) {
    const value = JSON.parse(prediction()); modify(value); expect(() => parseClassifierPrediction(JSON.stringify(value))).toThrow();
  }
});
it('separates explicit abstain and threshold abstention without claiming probability calibration', () => {
  for (const [text, reason] of [[prediction('abstain'), 'model_abstain'], [prediction('attend', 0.4), 'uncertain']]) {
    const adapter = new ClassifierShadowAdapter(options());
    expect(adapter.complete(adapter.bind(window()), text)).toMatchObject({ status: 'shadow', label: 'abstain', reason });
  }
});
it('uses host revocation, not observation-frame equality, and fails closed before any shadow retention', () => {
  for (const cause of ['track_lost', 'track_replaced', 'stop', 'user_intent', 'epoch', 'permission']) {
    const state = { cause: null }, adapter = new ClassifierShadowAdapter(options({ isCurrent: () => state.cause === null }));
    const binding = adapter.bind(window()); state.cause = cause;
    expect(adapter.complete(binding, prediction())).toEqual({ status: 'dropped', reason: 'host_revoked' });
  }
  let latestPosition = 0;
  const adapter = new ClassifierShadowAdapter(options({ isCurrent: () => latestPosition >= 0 })), binding = adapter.bind(window());
  latestPosition = 0.8; expect(adapter.complete(binding, prediction()).status).toBe('shadow');
  for (const extra of [{ now: () => 5000 }, { now: () => -1 }, { now: () => NaN }, { isCurrent: () => { throw Error('host_failed'); } }]) {
    const guarded = new ClassifierShadowAdapter(options(extra));
    expect(guarded.complete(guarded.bind(window()), prediction()).status).toBe('dropped');
  }
});
it('bounds retained dedup records and rejects copied binding tokens', () => {
  const adapter = new ClassifierShadowAdapter(options({ capacity: 1 })), binding = adapter.bind(window());
  expect(adapter.complete({ ...binding }, prediction()).reason).toBe('binding_unknown_or_completed');
  expect(() => adapter.bind(window())).toThrow('classifier_binding_duplicate');
  const next = window(); next.request.requestId = 'next'; expect(() => adapter.bind(next)).toThrow('classifier_binding_capacity');
  expect(adapter.retainedCount).toBe(1); adapter.clear(); expect(adapter.retainedCount).toBe(0);
  expect(adapter.complete(binding, prediction()).reason).toBe('binding_unknown_or_completed');
  expect(adapter.bind(next).request.requestId).toBe('next');
});

it('fails closed when the clock throws and does not retry the consumed result', () => {
  const adapter = new ClassifierShadowAdapter(options({ now: () => { throw Error('clock_unavailable'); } }));
  const binding = adapter.bind(window());
  expect(adapter.complete(binding, prediction())).toEqual({ status: 'dropped', reason: 'clock_failed' });
  expect(adapter.complete(binding, prediction())).toEqual({ status: 'dropped', reason: 'binding_unknown_or_completed' });
});
