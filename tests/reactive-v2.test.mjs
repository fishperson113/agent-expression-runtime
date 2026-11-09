import { expect, it } from 'vitest';
import { reactiveProviderConfig, reactiveResponsesAdapter } from '../integrations/reactive-provider.mjs';
import { reactiveDecisionSchemaV2, parseReactiveResponse } from '../integrations/reactive-decision.mjs';
import { freezeReactiveWindow, freezeReactiveCandidate } from '../integrations/reactive-window.mjs';
import { LiveCompiler } from '../src/core/live/compiler';
import { createLiveReactiveProvider } from '../integrations/live-reactive-provider.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';

const config = { enabled: true, model: 'fake', endpoint: 'http://127.0.0.1:1/responses' };
const snapshot = () => ({ orientation: 1, expression: 2, handMotion: 3, handIdentity: 4 });
const window = (version = 2) => ({ schemaVersion: 1, request: { schemaVersion: version, sessionId: 's', epoch: 'e', requestId: 'r',
  intentRevision: 0, presenceRevision: 1, deadline: 5000, requiredTrackIds: [], ...(version === 2 ? { semanticSnapshot: snapshot() } : {}) },
  events: [{ id: 1, type: 'expression_changed', at: 100 }], observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100,
    camera: 'absent', turn: 'idle', summary: 'PRIVATE_LOCAL_ONLY', user: { present: false, quality: { score: 0, basis: 'unavailable' },
      position: null, head: null, facingScreen: null, expression: null, mouthMoving: null } }] });
const body = () => ({ type: 'sequence', children: [{ type: 'parallel', children: [{ type: 'morph', target: 'sphere', durationMs: 1000 }] }] });
const decision = (version = 2) => ({ schemaVersion: version, requestId: 'r', decisionId: 'd', mode: 'express', validUntil: 4900,
  ...(version === 2 ? { prerequisites: [] } : {}), action: { actionId: 'a', body: body() } });
const response = value => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
it('keeps v1 default, explicitly selects v2, rejects unknown settings and exposes immutable contract metadata', () => {
  const env = { FISCH_REACTIVE_BACKEND: 'responses', FISCH_REACTIVE_MODEL: 'fake', FISCH_REACTIVE_URL: config.endpoint };
  expect(reactiveProviderConfig(env).contractVersion).toBe(1);
  expect(reactiveProviderConfig({ ...env, FISCH_REACTIVE_CONTRACT_VERSION: '2' }).contractVersion).toBe(2);
  for (const version of ['0', '3', '02', 2]) expect(() => reactiveProviderConfig({ ...env, FISCH_REACTIVE_CONTRACT_VERSION: version })).toThrow('reactive_contract_invalid');
  const adapter = reactiveResponsesAdapter({ ...config, contractVersion: 2 }, { reserve: async () => true });
  expect(adapter.contractVersion).toBe(2); expect(() => { adapter.contractVersion = 1; }).toThrow();
  expect(() => reactiveResponsesAdapter({ ...config, contractVersion: 3 }, { reserve: async () => true })).toThrow('reactive_contract_invalid');
});
it('requires the exact nullable semantic snapshot and compares every outer/window counter', () => {
  expect(freezeReactiveWindow(window()).request.semanticSnapshot).toEqual(snapshot());
  const unknown = window(); unknown.request.semanticSnapshot.orientation = null;
  expect(freezeReactiveWindow(unknown).request.semanticSnapshot.orientation).toBe(null);
  for (const patch of [{ semanticSnapshot: undefined }, { semanticSnapshot: { ...snapshot(), raw: 'PRIVATE' } },
    { semanticSnapshot: { ...snapshot(), orientation: -1 } }, { semanticSnapshot: { ...snapshot(), handIdentity: null } }, { semanticSnapshot: { ...snapshot(), expression: 0.5 } }])
    expect(() => freezeReactiveWindow({ ...window(), request: { ...window().request, ...patch } })).toThrow('reactive_window_invalid');
  for (const field of Object.keys(snapshot())) {
    const inner = window(); expect(() => freezeReactiveCandidate({ request: { ...inner.request,
      semanticSnapshot: { ...snapshot(), [field]: 99 } }, observationWindow: inner })).toThrow('reactive_candidate_mismatch');
  }
  const v1 = window(1); v1.request.semanticSnapshot = snapshot(); expect(() => freezeReactiveWindow(v1)).toThrow();
  const hand = window(); hand.request.handReadSet = { stateRevision: 0, sourceGeneration: 0, primaryTrackId: null };
  hand.request.semanticSnapshot.handIdentity = null; expect(() => freezeReactiveWindow(hand)).toThrow();
});
it('rejects configured/request version mismatch before any reservation or fetch', async () => {
  for (const [configured, requested] of [[1, 2], [2, 1]]) {
    let reserves = 0, calls = 0;
    const adapter = reactiveResponsesAdapter({ ...config, contractVersion: configured }, { reserve: async () => { reserves++; return true; },
      fetch: async () => { calls++; return new Response(JSON.stringify(response(decision(configured)))); } });
    await expect(adapter.decide(window(requested))).rejects.toMatchObject({ code: 'reactive_contract_mismatch', transportSettled: true });
    expect(reserves).toBe(0); expect(calls).toBe(0);
  }
});
it('accepts explicit unique prerequisites and observe while rejecting duplicates, version drift and model leases', () => {
  const parse = value => parseReactiveResponse(response(value), window().request, 2);
  expect(parse(decision()).prerequisites).toEqual([]);
  for (const [prerequisite, axis] of [['orientation', 'orientation'], ['expression', 'expression'], ['hand_motion', 'handMotion']]) {
    const request = window().request; request.semanticSnapshot[axis] = null;
    expect(() => parseReactiveResponse(response({ ...decision(), prerequisites: [prerequisite] }), request, 2)).toThrow('reactive_decision_invalid');
    expect(parseReactiveResponse(response(decision()), request, 2).prerequisites).toEqual([]);
  }
  expect(parse({ ...decision(), prerequisites: ['orientation', 'expression', 'hand_motion'] }).schemaVersion).toBe(2);
  expect(parse({ ...decision(), mode: 'observe', action: null })).toMatchObject({ mode: 'observe', prerequisites: [] });
  for (const patch of [{ prerequisites: ['orientation', 'orientation'] }, { prerequisites: ['identity'] }, { prerequisites: undefined },
    { executionValidUntil: 999999 }, { validUntil: 5001 }, { schemaVersion: 1 }]) expect(() => parse({ ...decision(), ...patch })).toThrow('reactive_decision_invalid');
  expect(() => parseReactiveResponse(response(decision()), window(1).request, 1)).toThrow('reactive_decision_invalid');
});
it('only accepts one parallel brief nonspatial phrase with bounded leaf durations', () => {
  const parse = value => parseReactiveResponse(response({ ...decision(), action: { actionId: 'a', body: value } }), window().request, 2);
  const parallel = body().children[0];
  for (const invalid of [{ type: 'live', program: null, configuration: {} }, { type: 'assemble', parts: [], durationMs: 500 },
    { ...body(), children: [parallel, parallel] }, { ...body(), children: [{ ...parallel, children: Array(4).fill(parallel.children[0]) }] },
    ...[0, 199, 1001].map(durationMs => ({ ...body(), children: [{ ...parallel, children: [{ ...parallel.children[0], durationMs }] }] })),
    { ...body(), children: [{ ...parallel, children: [{ ...parallel.children[0], x: 1 }] }] }]) expect(() => parse(invalid)).toThrow();
  expect(parse(body()).action.body).toEqual(body());
});
it('sends closed strict v2 schema without uniqueItems and binds new prompt/request receipt hashes', async () => {
  const sent = [], receipts = [];
  for (const version of [1, 2]) {
    const adapter = reactiveResponsesAdapter({ ...config, contractVersion: version }, { reserve: async () => true,
      fetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return new Response(JSON.stringify(response(decision(version)))); } });
    expect((await adapter.decide(window(version), undefined, value => receipts.push(value))).schemaVersion).toBe(version);
  }
  expect(sent[1].tools).toEqual([]); expect(sent[1].tool_choice).toBe('none'); expect(sent[1].store).toBe(false);
  expect(sent[1].instructions).toContain('cannot be waived'); expect(JSON.stringify(sent[1])).not.toContain('PRIVATE_LOCAL_ONLY');
  expect(sent[1].text.format.schema).toEqual(reactiveDecisionSchemaV2); expect(JSON.stringify(reactiveDecisionSchemaV2)).not.toContain('uniqueItems');
  function inspect(value) { if (!value || typeof value !== 'object') return;
    if (value.type === 'object') { expect(value.additionalProperties).toBe(false); expect([...value.required].sort()).toEqual(Object.keys(value.properties).sort()); }
    for (const nested of Object.values(value)) Array.isArray(nested) ? nested.forEach(inspect) : inspect(nested); }
  inspect(reactiveDecisionSchemaV2);
  expect(receipts[1].promptHash).not.toBe(receipts[0].promptHash); expect(receipts[1].requestHash).not.toBe(receipts[0].requestHash);
});
it('advertises v2 only from explicit provider capability without changing hand version', async () => {
  for (const version of [undefined, 1, 2, 3]) {
    const calls = [], api = { activity() {}, configureReactive: (...args) => calls.push(args), setReactiveUserBusy() {}, takeReactiveRequest: () => null };
    const page = { evaluate: async (fn, args) => { const old = globalThis.window; globalThis.window = { fischLive: api };
      try { return await fn(args); } finally { globalThis.window = old; } } };
    const broker = new LiveReactiveBroker({ page, provider: { contractVersion: version, decide: async () => null },
      output: {}, forward() {}, reject() {} });
    await broker.poll({}); expect(calls).toEqual([[true, 1, version === 2 ? 2 : 1]]); broker.close();
  }
});

it('keeps parallel leaf composition within the shared compiler duration cap', () => {
  const phrase = body(); phrase.children[0].children.push({ type: 'flow', field: 'pulse', strength: 0.5, durationMs: 200 },
    { type: 'shapeQuality', rise: 0.15, grow: 1.1, effort: { time: 0.5, weight: 0.4, flow: 0.7 }, durationMs: 500 });
  const value = parseReactiveResponse(response({ ...decision(), action: { actionId: 'a', body: phrase } }), window().request, 2);
  const compiled = new LiveCompiler().compile({ v: 1, epoch: 'e', seq: 1, kind: 'program', track: 'body', policy: 'replace', body: value.action.body }, 0);
  expect(compiled.program.duration).toBe(1000);
});
it('factory forwards explicit v2 without exposing credentials or widening native environment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fisch-v2-'));
  try {
    const path = join(directory, 'budget.json'); writeFileSync(path, JSON.stringify({ used: 0, limit: 120, deadline: new Date(10000).toISOString(), turns: [] }));
    const result = createLiveReactiveProvider({ FISCH_REACTIVE_BACKEND: 'responses', FISCH_REACTIVE_CONTRACT_VERSION: '2',
      FISCH_REACTIVE_MODEL: 'fake', FISCH_REACTIVE_URL: config.endpoint, FISCH_REACTIVE_API_KEY: 'PRIVATE', FISCH_REACTIVE_BUDGET: path }, { now: () => 100 });
    expect(result.reason).toBe('ready'); expect(result.provider.contractVersion).toBe(2);
    expect(JSON.stringify(result)).toBe('{"provider":{},"reason":"ready"}');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
