import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifierGatedProvider } from '../integrations/classifier-gated-provider.mjs';
import { createLiveReactiveProvider } from '../integrations/live-reactive-provider.mjs';

const labels = ['observe', 'attend', 'acknowledge', 'playful', 'abstain'];
const prediction = (label = 'attend', confidence = 0.9) => JSON.stringify({ schemaVersion: 1, label,
  scores: Object.fromEntries(labels.map(key => [key, key === label ? confidence : (1 - confidence) / 4])) });
const window = (id = 'r', version = 2) => ({ schemaVersion: 1, request: { schemaVersion: version,
  sessionId: 's', epoch: 'e', requestId: id, intentRevision: 1, presenceRevision: 1, deadline: 5000, requiredTrackIds: [],
  ...(version === 2 ? { semanticSnapshot: { orientation: null, expression: null, handMotion: null, handIdentity: 1 } } : {}) },
  events: [{ id: 1, type: 'expression_changed', at: 100 }], observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100,
    camera: 'absent', turn: 'idle', summary: 'not transmitted', user: { present: false, quality: { score: 0, basis: 'unavailable' },
      position: null, head: null, facingScreen: null, expression: null, mouthMoving: null } }] });
const options = extra => ({ modelId: 'convaiinnovations/laya', modelRevision: 'pinned', minConfidence: 0.7, minMargin: 0.15,
  classify: async () => prediction(), now: () => 1000, ...extra });
const provider = version => ({ contractVersion: version, decide: vi.fn(async () => ({ marker: 'unchanged_semantic_result' })) });
const dirs = [];
afterEach(() => dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

it('requires an explicit request-domain clock instead of comparing foreign process uptimes', async () => {
  const semantic = provider(2), missing = options(); delete missing.now;
  expect(() => classifierGatedProvider(semantic, missing)).toThrow('classifier_gate_config');
  const foreignProcessUptime = 9000000, requestClock = () => 1000;
  expect(foreignProcessUptime).toBeGreaterThan(window().request.deadline);
  const gate = classifierGatedProvider(semantic, options({ now: requestClock, classify: async () => prediction('observe') }));
  await expect(gate.decide(window())).resolves.toMatchObject({ mode: 'observe' });
});

it('returns host-owned no-op for observe, abstain, low confidence, invalid output and classifier failure', async () => {
  for (const version of [1, 2]) for (const classify of [async () => prediction('observe'), async () => prediction('abstain'),
    async () => prediction('attend', 0.4), async () => '{"label":"unsafe"}', async () => { throw Error('local_failure'); }]) {
    const semantic = provider(version), gate = classifierGatedProvider(semantic, options({ classify }));
    const result = await gate.decide(window('r', version));
    expect(result).toMatchObject({ schemaVersion: version, requestId: 'r', mode: 'observe', validUntil: 5000, action: null });
    expect(result.decisionId.length).toBeLessThanOrEqual(64);
    if (version === 2) expect(result.prerequisites).toEqual([]);
    expect(semantic.decide).not.toHaveBeenCalled();
  }
});
it('delegates positive abstract categories unchanged and records only bounded metadata', async () => {
  for (const label of ['attend', 'acknowledge', 'playful']) {
    const semantic = provider(2), records = [], signal = new AbortController().signal, receipt = () => {};
    const classify = vi.fn(async frozen => { expect(frozen.observations[0]).not.toHaveProperty('summary'); return prediction(label); });
    const gate = classifierGatedProvider(semantic, options({ classify, onClassification: value => records.push(value) }));
    expect(await gate.decide(window(), signal, receipt)).toEqual({ marker: 'unchanged_semantic_result' });
    const forwarded = semantic.decide.mock.calls[0];
    expect(forwarded[0]).toEqual({ ...classify.mock.calls[0][0], observations: classify.mock.calls[0][0].observations.map(value => ({ ...value, summary: '' })) });
    expect(forwarded.slice(1)).toEqual([signal, receipt]);
    expect(records).toEqual([{ requestId: 'r', modelId: 'convaiinnovations/laya', modelRevision: 'pinned', label, reason: 'classifier_choice' }]);
  }
});
it('rechecks abort, deadline and failing clocks after inference and before semantic dispatch', async () => {
  for (const mutate of [state => state.abort.abort(), state => { state.now = 5000; }, state => { state.now = NaN; },
    state => { state.now = null; }]) {
    const state = { now: 1000, abort: new AbortController() }, semantic = provider(2);
    const gate = classifierGatedProvider(semantic, options({ now: () => { if (state.now === null) throw Error('clock'); return state.now; },
      classify: async () => { mutate(state); return prediction(); } }));
    await expect(gate.decide(window(), state.abort.signal)).rejects.toThrow(); expect(semantic.decide).not.toHaveBeenCalled();
  }
  const semantic = provider(2), abort = new AbortController();
  const gate = classifierGatedProvider(semantic, options({ onClassification: () => abort.abort() }));
  await expect(gate.decide(window(), abort.signal)).rejects.toThrow('reactive_aborted'); expect(semantic.decide).not.toHaveBeenCalled();
  const late = new AbortController(), downstream = { contractVersion: 2, decide: async () => { late.abort(); return { mode: 'express' }; } };
  await expect(classifierGatedProvider(downstream, options()).decide(window(), late.signal)).rejects.toThrow('reactive_aborted');
});
it('bounds concurrent work and dedup without releasing ownership before local inference settles', async () => {
  let settle;
  const semantic = provider(2), gate = classifierGatedProvider(semantic, options({ classify: () => new Promise(resolve => { settle = resolve; }) }));
  const pending = gate.decide(window());
  await expect(gate.decide(window('r2'))).rejects.toThrow('classifier_gate_capacity');
  settle(prediction('observe')); await pending;
  await expect(gate.decide(window())).rejects.toThrow('classifier_gate_capacity'); expect(semantic.decide).not.toHaveBeenCalled();
  const bounded = classifierGatedProvider(semantic, options({ classify: async () => prediction('observe') }));
  for (let i = 0; i < 256; i++) await bounded.decide(window('r' + i));
  await expect(bounded.decide(window('overflow'))).rejects.toThrow('classifier_gate_capacity');
});
it('factory preserves budget and provider opt-in while no-ops avoid reservations and positive choices reserve normally', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fisch-classifier-gate-')); dirs.push(directory);
  const path = join(directory, 'fixture-ledger.json');
  writeFileSync(path, JSON.stringify({ deadline: new Date(10000).toISOString(), limit: 120, used: 119, turns: [] }));
  const env = { FISCH_REACTIVE_BACKEND: 'responses', FISCH_REACTIVE_CONTRACT_VERSION: '2', FISCH_REACTIVE_MODEL: 'fixture',
    FISCH_REACTIVE_URL: 'https://provider.invalid/responses', FISCH_REACTIVE_BUDGET: path };
  const fetch = vi.fn(async (_url, request) => { const input = JSON.parse(JSON.parse(request.body).input);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify({ schemaVersion: 2, requestId: input.request.requestId,
        decisionId: 'd', mode: 'observe', validUntil: 5000, action: null, prerequisites: [] }) }] }] })); });
  let label = 'observe'; const classifier = options({ classify: async () => prediction(label) });
  const result = createLiveReactiveProvider(env, { now: () => 100, fetch, classifier });
  expect(createLiveReactiveProvider(env, { now: () => 100, classifier: {} }).reason).toBe('invalid_classifier_config');
  expect(result.reason).toBe('ready_classifier_gated'); await result.provider.decide(window());
  expect(JSON.parse(readFileSync(path)).used).toBe(119); expect(fetch).not.toHaveBeenCalled();
  label = 'playful'; await result.provider.decide(window('positive'));
  expect(JSON.parse(readFileSync(path)).used).toBe(120); expect(fetch).toHaveBeenCalledTimes(1);
  expect(createLiveReactiveProvider({}, { classifier }).reason).toBe('disabled_by_config');
  expect(createLiveReactiveProvider(env, { now: () => 100, classifier: {} }).reason).toBe('budget_exhausted');
});
