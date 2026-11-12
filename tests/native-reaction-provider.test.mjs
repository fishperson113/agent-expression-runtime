import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PlannerRpc } from '../integrations/planner-rpc.mjs';
import { tmpdir } from 'node:os';
import { emptyObserverCapabilities, observerServerArgs, verifyObserverServers } from '../integrations/native-observer-isolation.mjs';
import { nativeVisualAuthoringGuide } from '../integrations/native-visual-authoring.mjs';
import { ReactiveProviderError } from '../integrations/reactive-provider.mjs';
import { LiveReactiveBroker } from '../integrations/live-reactive-broker.mjs';
import { NativeReactionProvider, freezeNativeHostCapabilities, nativeReactionEnvironment, presenceReactionData, reactionObservationData } from '../integrations/native-reaction-provider.mjs';
const window = () => ({ schemaVersion: 1, request: { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'r', intentRevision: 0,
  presenceRevision: 1, deadline: 60000, requiredTrackIds: [] }, events: [{ id: 1, type: 'user_arrived', at: 100 }],
  observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100, camera: 'absent', turn: 'working', summary: 'PRIVATE_INSTRUCTION_CANARY',
    user: { present: false, quality: { score: 0, basis: 'unavailable' }, position: null, head: null, facingScreen: null, expression: null, mouthMoving: null } }] });
const retain = { reply: 'Mình thấy bạn vừa quay lại.', decision: { mode: 'retain', reasonCode: 'presence', payload: null } };
function fixture({ catalog = [], response = retain, pending = false, pendingAck = false, reserve = async () => {}, confirmedClose = true, nativeError = null, nativeStatus = 'completed', missingConfig = false, featurePatch = {}, requestedModel, effectiveModel, now, inheritedMcp = false } = {}) {
  const calls = [], processes = []; let notify;
  const provider = new NativeReactionProvider({ command: 'codex', reserve, model: requestedModel }, { env: { HOME: '/native-auth', AER_PAIRING_TOKEN: 'SECRET', OPENAI_API_KEY: 'SECRET', PATH: 'native' },
    settleTimeoutMs: 10, now, rpcFactory: (command, args, cwd, event, failed, env) => {
      notify = event;
      let rejectAck; let confirm; const settled = new Promise(resolve => { confirm = resolve; });
      const rpc = { settled, closed: false, command, args, env, send: () => {}, close: () => { rpc.closed = true; if (confirmedClose) confirm(); rejectAck?.(Error('planner_process_closed')); failed('closed'); },
        request: async (method, params) => {
          calls.push({ method, params });
          if (method === 'config/read') return missingConfig ? {} : { config: { mcp_servers: { fisch_live: { enabled: inheritedMcp && !args.includes('mcp_servers.fisch_live.enabled=false') } }, features: { ...Object.fromEntries(['shell_tool', 'apps', 'plugins', 'hooks', 'multi_agent', 'computer_use', 'browser_use', 'image_generation', 'view_image'].map(key => [key, false])), ...featurePatch } } };
          if (method === 'thread/start') return { thread: { id: 'reaction-thread' }, ...(effectiveModel ? { model: effectiveModel } : {}) };
          if (method === 'mcpServerStatus/list') return { data: catalog, nextCursor: null };
          if (method === 'turn/start') {
            if (pendingAck) return new Promise((_resolve, reject) => { rejectAck = reject; });
            if (!pending) queueMicrotask(() => {
              event('item/completed', { threadId: 'reaction-thread', turnId: 'reaction-turn', item: { type: 'agentMessage', phase: 'commentary', text: 'not a final response' } });
              event('item/completed', { threadId: 'reaction-thread', turnId: 'reaction-turn', item: { type: 'agentMessage', text: JSON.stringify(response) } });
              event('turn/completed', { threadId: 'reaction-thread', turn: { id: 'reaction-turn', status: nativeStatus, error: nativeError } });
            });
            return { turn: { id: 'reaction-turn' } };
          }
          return {};
        } };
      processes.push(rpc); return rpc;
    } });
  return { provider, calls, processes, event: (...args) => notify(...args) };
}
it('projects only typed presence evidence and strips summary/head/expression/task state', () => {
  const data = presenceReactionData(window()), text = JSON.stringify(data);
  expect(text).not.toMatch(/PRIVATE|head|expression|mouth|working/);
  expect(data.observations[0].user).toEqual({ present: false, quality: { score: 0, basis: 'unavailable' } });
  expect(() => presenceReactionData({ ...window(), events: [{ id: 1, type: 'mouth_started', at: 100 }] })).toThrow('event_required');
});
it('uses a separate readonly native lane, proves empty MCP catalog before reserve/inference, and returns host IDs', async () => {
  let reserved = 0; const f = fixture({ reserve: async () => { reserved++; expect(f.calls.at(-1).method).toBe('mcpServerStatus/list'); } });
  try {
    const result = await f.provider.decide(window(), new AbortController().signal, undefined, { schemaVersion: 1, expressionAllowed: true });
    expect(result.decision).toMatchObject({ schemaVersion: 1, requestId: 'r', mode: 'observe', validUntil: 60000, action: null });
    expect(result.reply).toBe(retain.reply); expect(result.nativeProvenance).toMatchObject({ processRole: 'observation-reaction', mcpCatalogVerifiedEmpty: true, threadId: 'reaction-thread' });
    expect(reserved).toBe(1); expect(f.processes[0].env).toEqual({ HOME: '/native-auth', PATH: 'native' });
    const thread = f.calls.find(c => c.method === 'thread/start').params;
    expect(thread.config.mcp_servers.fisch_live.enabled).toBe(false); expect(thread.dynamicTools).toEqual([]);
    expect(thread.developerInstructions).toBe(''); expect(f.processes[0].args).toContain('developer_instructions=""');
    expect(thread.baseInstructions).toContain(nativeVisualAuthoringGuide); expect(thread.baseInstructions).not.toContain('PRIVATE'); expect(f.processes[0].args).toContain('shell_tool');
    expect(JSON.stringify(f.calls.find(c => c.method === 'turn/start').params.input)).not.toContain('PRIVATE');
  } finally { f.provider.close(); }
});
it('fails closed before any inference if MCP visibility is nonempty or reservation fails', async () => {
  for (const options of [{ catalog: [{ name: 'fisch_live', tools: {} }] }, { reserve: async () => { throw Error('budget_exhausted'); } }]) {
    const f = fixture(options);
    try { await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toThrow(); expect(f.calls.some(c => c.method === 'turn/start')).toBe(false); }
    finally { f.provider.close(); }
  }
});
it('aborts only its reaction process/turn, blocks overlap, and does not publish a delayed final', async () => {
  const f = fixture({ pending: true }), controller = new AbortController();
  const run = f.provider.decide(window(), controller.signal);
  try {
    while (!f.calls.some(c => c.method === 'turn/start')) await new Promise(resolve => setImmediate(resolve));
    await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toThrow('unavailable');
    controller.abort(); await expect(run).rejects.toMatchObject({ message: 'native_reaction_aborted', transportSettled: true }); expect(f.processes[0].closed).toBe(true);
    f.event('turn/completed', { threadId: 'reaction-thread', turn: { id: 'reaction-turn', status: 'completed' } });
    expect(f.calls.filter(c => c.method === 'turn/interrupt').every(c => c.params.threadId === 'reaction-thread')).toBe(true);
    const again = new AbortController(), restarted = f.provider.decide(window(), again.signal);
    while (f.processes.length < 2 || !f.calls.filter(c => c.method === 'turn/start').slice(1).length) await new Promise(resolve => setImmediate(resolve));
    again.abort(); await expect(restarted).rejects.toThrow(); expect(f.processes).toHaveLength(2);
  } finally { f.provider.close(); }
});
it('never mutates the parent environment and rejects malformed typed data before starting a process', async () => {
  const environment = { HOME: 'auth', AER_BASE_URL: 'secret', FISCH_LIVE: 'secret', CODEX_THREAD_ID: 'main', OPENAI_API_KEY: 'secret' };
  expect(nativeReactionEnvironment(environment)).toEqual({ HOME: 'auth' }); expect(environment.CODEX_THREAD_ID).toBe('main');
  const f = fixture();
  try { await expect(f.provider.decide({ ...window(), transcript: 'private' }, new AbortController().signal)).rejects.toThrow(); }
  finally { f.provider.close(); }
});
it('converts unrestricted authored geometry and existing live animation without a preset mapping', async () => {
  const responses = [
    { reply: '', decision: { mode: 'compose', reasonCode: 'presence_form', payload: {
      parts: [{ id: 'new_form', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.2, 0.3, 0.1], rotation: null, weight: null, motion: null }],
      base: 'none', durationMs: 300, easing: 'smoothstep', style: null, flow: null } } },
    { reply: '', decision: { mode: 'animate', reasonCode: 'subtle_motion', payload: { controls: [], poses: [], lifetimeMs: 1000 } } },
  ];
  for (const response of responses) {
    const f = fixture({ response });
    try {
      const result = await f.provider.decide(window(), new AbortController().signal, undefined, { schemaVersion: 1, expressionAllowed: true });
      expect(result.decision.mode).toBe('express'); expect(result.decision.action.body.type).toBe(response.decision.mode === 'compose' ? 'parallel' : 'live');
      expect(result.decision.action.actionId).toMatch(/^[a-f0-9-]{36}$/);
    } finally { f.provider.close(); }
  }
});
it('rejects malformed final responses and explicit budget denial without fallback text or effects', async () => {
  for (const response of [{ reply: 'x' }, { ...retain, reply: 'x'.repeat(601) }]) {
    const f = fixture({ response });
    try { await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toThrow(); }
    finally { f.provider.close(); }
  }
  const f = fixture({ reserve: async () => false });
  try {
    await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toThrow('reactive_budget_denied');
    expect(f.calls.some(c => c.method === 'turn/start')).toBe(false);
  } finally { f.provider.close(); }
});
it('clears only a confirmed closed reaction transport; unknown close leaves the broker uncertain', async () => {
  for (const confirmedClose of [true, false]) {
    const f = fixture({ pending: true, confirmedClose }), controller = new AbortController();
    const run = f.provider.decide(window(), controller.signal);
    while (!f.calls.some(c => c.method === 'turn/start')) await new Promise(resolve => setImmediate(resolve));
    controller.abort(); const error = await run.catch(value => value);
    expect(error).toBeInstanceOf(ReactiveProviderError); expect(error.transportSettled).toBe(confirmedClose);
    const broker = new LiveReactiveBroker({ page: {}, output: {}, forward: () => {}, reject: () => {} });
    const owned = { id: 'r', controller: new AbortController() }; broker.active = owned;
    broker.deliver = async () => {}; broker.fail = async () => {};
    await broker.failed(owned, error);
    expect(broker.uncertain).toBe(!confirmedClose); expect(broker.active === undefined).toBe(confirmedClose);
    if (!confirmedClose) await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toMatchObject({ transportSettled: false });
    broker.close(); f.provider.close();
  }
});
it('marks pre-inference rejection and invalid output after a known terminal as settled', async () => {
  for (const options of [{ reserve: async () => false }, { response: { reply: 'invalid' } }]) {
    const f = fixture(options);
    try { await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toMatchObject({ transportSettled: true }); }
    finally { f.provider.close(); }
  }
});
it('confirms a real RPC child close separately from logical close', async () => {
  const rpc = new PlannerRpc(process.execPath, ['-e', 'setInterval(()=>{},1000)'], tmpdir(), () => {}, () => {}, {});
  let confirmed = false; rpc.settled.then(() => { confirmed = true; });
  try { rpc.close(); expect(rpc.closed).toBe(true); expect(confirmed).toBe(false); await rpc.settled; expect(confirmed).toBe(true); }
  finally { rpc.close(); }
});
it('preserves bounded Native terminal errors only in explicit Node diagnostics', async () => {
  const nativeError = { message: 'schema/auth diagnostic', codexErrorInfo: { other: 'native_code' } };
  const f = fixture({ nativeError, nativeStatus: 'failed' });
  try {
    await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toMatchObject({ transportSettled: true });
    const diagnostics = f.provider.diagnostics();
    expect(diagnostics.lastFailure).toMatchObject({ requestId: 'r', threadId: 'reaction-thread', turnId: 'reaction-turn', status: 'failed', error: nativeError });
    expect(diagnostics.nativeTrace).toHaveLength(2); expect(JSON.stringify(f.provider)).not.toContain('schema/auth diagnostic');
    diagnostics.lastFailure.error.message = 'mutated'; expect(f.provider.diagnostics().lastFailure.error.message).toBe('schema/auth diagnostic');
  } finally { f.provider.close(); }
});
it('bounds diagnostic history/errors and retains missing config and tools verification codes', async () => {
  const f = fixture({ nativeError: { message: 'x'.repeat(70000) }, nativeStatus: 'failed' });
  try {
    for (let i = 0; i < 6; i++) await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toThrow();
    const trace = f.provider.diagnostics(); expect(trace.nativeTrace).toHaveLength(8); expect(trace.lastFailure.error.truncated).toBe(true);
    expect(JSON.stringify(trace).length).toBeLessThan(150000);
  } finally { f.provider.close(); }
  for (const [options, code] of [[{ missingConfig: true }, 'native_reaction_config_unverified'], [{ catalog: [{}] }, 'native_reaction_tools_unverified']]) {
    const g = fixture(options);
    try { await expect(g.provider.decide(window(), new AbortController().signal)).rejects.toThrow(); expect(g.provider.diagnostics().lastFailure.code).toBe(code); }
    finally { g.provider.close(); }
  }
});
it('requires effective disabled feature flags before inference and makes only verified provenance claims', async () => {
  for (const featurePatch of [{ shell_tool: true }, { apps: undefined }, { plugins: null }]) {
    const f = fixture({ featurePatch });
    try {
      await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toThrow('native_reaction_features_unverified');
      expect(f.calls.some(c => c.method === 'turn/start')).toBe(false);
    } finally { f.provider.close(); }
  }
  const f = fixture();
  try { expect((await f.provider.decide(window(), new AbortController().signal)).nativeProvenance).not.toHaveProperty('isolated'); }
  finally { f.provider.close(); }
});
it('projects only the axes needed by relevant face cues and preserves null unknowns', () => {
  const source = window(); source.observations[0].user = { ...source.observations[0].user, present: true, facingScreen: false,
    head: { yaw: 12, pitch: 2, roll: 0 }, expression: { smile: 0.4, browRaise: 0.2, eyesClosed: 0, mouthOpen: 0.1 } };
  for (const [type, expected] of [['user_arrived', []], ['looked_away', ['facingScreen']], ['expression_changed', ['expression']]]) {
    const data = reactionObservationData({ ...source, events: [{ id: 1, type, at: 100 }] });
    expect(Object.keys(data.observations[0].user).sort()).toEqual(['present', 'quality', ...expected].sort());
    expect(JSON.stringify(data)).not.toMatch(/PRIVATE|yaw|pitch|roll|working/);
    if (type === 'expression_changed') expect(data.expressionMeaning).toBe('geometric_coefficients_not_emotion');
  }
  source.observations[0].user.facingScreen = null; source.observations[0].user.expression = null;
  const data = reactionObservationData({ ...source, events: [{ id: 1, type: 'looked_back', at: 100 }, { id: 2, type: 'expression_changed', at: 100 }] });
  expect(data.observations[0].user).toMatchObject({ facingScreen: null, expression: null });
});
it('projects coarse normalized wrist regions only for hand cues, distinguishing missing from known lost tracking', () => {
  const source = window(); source.request.handReadSet = { stateRevision: 1, sourceGeneration: 1, primaryTrackId: 'hand_1_1' };
  const hands = { v: 1, trackingState: 'tracked', coordinateSpace: 'image-normalized', landmarkSchema: 'mediapipe-hand-21',
    zMeaning: 'wrist-relative-image-width', mirrored: false, sourceWidth: 640, sourceHeight: 480, primaryTrackId: 'hand_1_1',
    entities: [{ detectionId: 0, trackId: 'hand_1_1', handedness: 'Left', confidence: 0.9,
      landmarks: Array.from({ length: 21 }, () => ({ x: 0.2, y: 0.3, z: -0.1 })) }] };
  source.observations[0].hands = hands;
  expect(reactionObservationData(source).observations[0]).not.toHaveProperty('hands');
  source.events = [{ id: 1, sourceSeq: 1, type: 'hand_appeared', at: 100, eventVersion: 1, trackId: 'hand_1_1',
    observationSeq: 1, evidenceStartSeq: 1, stateRevision: 1, sourceGeneration: 1 }];
  const projected = reactionObservationData(source).observations[0].hands;
  expect(projected.entities).toEqual([{ trackId: 'hand_1_1', confidence: 0.9, wrist: { xCell: 0, yCell: 1, grid: 4 } }]);
  expect(projected.projectionMeaning).toBe('coarse_image_normalized_wrist_region_not_metric_distance');
  expect(projected).not.toHaveProperty('zMeaning'); expect(projected.entities[0].wrist).not.toHaveProperty('z');
  source.observations[0].hands.entities[0].landmarks[0] = { x: 0.24, y: 0.49, z: 2 };
  expect(reactionObservationData(source).observations[0].hands.entities[0].wrist).toEqual(projected.entities[0].wrist);
  source.observations[0].hands.entities[0].landmarks[0].x = 0.26;
  expect(reactionObservationData(source).observations[0].hands.entities[0].wrist.xCell).toBe(1); expect(JSON.stringify(projected)).not.toContain('landmarks');
  delete source.observations[0].hands; expect(reactionObservationData(source).observations[0].hands).toBe(null);
  source.observations[0].hands = { ...hands, trackingState: 'lost', primaryTrackId: null, entities: [] };
  expect(reactionObservationData(source).observations[0].hands).toMatchObject({ trackingState: 'lost', primaryTrackId: null, entities: [] });
});
it('records exact policy/schema/projected-input/config/model hashes without raw data or invented effective model', async () => {
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
  for (const options of [{}, { requestedModel: 'requested-model', effectiveModel: 'effective-model' }]) {
    const f = fixture(options);
    try {
      const result = await f.provider.decide(window(), new AbortController().signal), metadata = result.nativeProvenance;
      const turn = f.calls.find(c => c.method === 'turn/start').params, thread = f.calls.find(c => c.method === 'thread/start').params;
      for (const key of ['policyHash', 'schemaHash', 'inputHash', 'configHash', 'mcpCatalogHash', 'modelHash']) expect(metadata[key]).toMatch(/^[a-f0-9]{64}$/);
      expect(metadata.policyHash).toBe(digest(thread.baseInstructions)); expect(metadata.schemaHash).toBe(digest(turn.outputSchema));
      expect(metadata.inputHash).toBe(digest(JSON.parse(turn.input[0].text)));
      expect(metadata.publishedHistoryCount).toBe(0); expect(metadata.publishedHistoryHash).toBe(digest([])); expect(metadata.mcpCatalogHash).toBe(digest([]));
      expect(metadata.requestedModel).toBe(options.requestedModel ?? null); expect(metadata.effectiveModel).toBe(options.effectiveModel ?? null);
      expect(metadata).toMatchObject({ requestId: 'r', decisionId: result.decision.decisionId, actionId: null, selectedMode: 'retain', reasonCode: 'presence' });
      const diagnostics = f.provider.diagnostics(); expect(diagnostics.lastResult).toEqual(metadata);
      expect(JSON.stringify(diagnostics.lastResult)).not.toMatch(/PRIVATE|observations|schema\/auth|Mình|baseInstructions/);
      diagnostics.lastResult.policyHash = 'mutated'; expect(f.provider.diagnostics().lastResult.policyHash).toBe(metadata.policyHash);
    } finally { f.provider.close(); }
  }
});

it('fences a late reaction result as soon as user intent arrives, before the browser barrier completes', async () => {
  for (const mode of ['aborted', 'pending']) {
    const output = { thread: 'main', turn: 'coding' }, values = [];
    const broker = new LiveReactiveBroker({ page: {}, output, provider: { conversationLane: true }, forward() {}, reject() {} });
    const owned = { id: 'reaction', controller: new AbortController(), terminal: false }; broker.active = owned;
    broker.deliver = async (_id, data) => values.push(data);
    if (mode === 'aborted') owned.controller.abort(); else broker.pending.set('user', { method: 'turn/steer' });
    await broker.finish(owned, { reply: 'must not appear' });
    expect(values).toEqual([null]); expect(broker.active).toBeUndefined(); expect(output.turn).toBe('coding'); broker.close();
  }
});

it('preserves human abort before turn ACK while separately confirming process closure', async () => {
  const f = fixture({ pendingAck: true }), controller = new AbortController();
  try {
    const run = f.provider.decide(window(), controller.signal);
    while (!f.calls.some(call => call.method === 'turn/start')) await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await expect(run).rejects.toMatchObject({ message: 'native_reaction_aborted', transportSettled: true });
    expect(f.provider.diagnostics().lastFailure).toMatchObject({ code: 'native_reaction_aborted', transportSettled: true, nativeTerminalAcknowledged: false, settlementBasis: 'local_process_closed' });
  } finally { f.provider.close(); }
});
const publication = result => ({ source: 'native-observation', requestId: result.decision.requestId,
  decisionId: result.decision.decisionId, reason: result.decision.mode === 'express' ? 'accepted' : 'observed', chatPublished: true });
async function contextCue(f, id, scope = {}) {
  const value = window(); Object.assign(value.request, { requestId: id, ...scope }); value.observations[0].sessionId = value.request.sessionId;
  const result = await f.provider.decide(value, new AbortController().signal, undefined, { schemaVersion: 1, expressionAllowed: true });
  const input = JSON.parse(f.calls.filter(call => call.method === 'turn/start').at(-1).params.input[0].text);
  return { value, result, input };
}
it('injects only browser-confirmed replies into a fresh thread, never dropped generated text', async () => {
  const f = fixture();
  try {
    const dropped = await contextCue(f, 'drop'), published = await contextCue(f, 'publish');
    expect(published.input.recentPublishedReactions).toEqual([]);
    expect(f.provider.confirmPublication(dropped.value.request, publication(dropped.result))).toBe(false);
    expect(f.provider.confirmPublication(published.value.request, publication(published.result))).toBe(true);
    expect(f.provider.confirmPublication(published.value.request, publication(published.result))).toBe(false);
    const next = await contextCue(f, 'next');
    expect(next.input.recentPublishedReactions).toHaveLength(1);
    expect(next.result.nativeProvenance.publishedHistoryCount).toBe(1); expect(next.result.nativeProvenance.publishedHistoryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(next.input.recentPublishedReactions[0]).toMatchObject({ requestId: 'publish', reply: retain.reply, chatPublished: true, expressionAdmission: 'none', currentGeometry: 'unknown' });
    expect(f.calls.filter(call => call.method === 'thread/start').every(call => call.params.ephemeral === true)).toBe(true);
  } finally { f.provider.close(); }
});
it('records expression admission separately and never imports an unshown caption or claims current geometry', async () => {
  const f = fixture({ response: { reply: 'Generated but not published', decision: { mode: 'animate', reasonCode: 'subtle', payload: { controls: [], poses: [], lifetimeMs: 1000 } } } });
  try {
    const previous = await contextCue(f, 'expression');
    expect(f.provider.confirmPublication(previous.value.request, { ...publication(previous.result), chatPublished: false, frame: 9 })).toBe(true);
    const next = await contextCue(f, 'next'); expect(next.input.recentPublishedReactions[0]).toMatchObject({ reply: '', chatPublished: false, expressionAdmission: 'admitted', currentGeometry: 'unknown', receiptFrame: 9 });
    expect(JSON.stringify(next.input)).not.toContain('Generated but not published');
  } finally { f.provider.close(); }
});
it('resets on session or epoch change and rejects wrong, aborted, expired or explicitly discarded confirmations', async () => {
  for (const scope of [{ epoch: 'new' }, { sessionId: 'new' }]) {
    const f = fixture();
    try { const first = await contextCue(f, 'first'); f.provider.confirmPublication(first.value.request, publication(first.result));
      expect((await contextCue(f, 'second', scope)).input.recentPublishedReactions).toEqual([]);
      expect(f.provider.confirmPublication(first.value.request, publication(first.result))).toBe(false);
    } finally { f.provider.close(); }
  }
  const f = fixture();
  try {
    const cue = await contextCue(f, 'wrong'); expect(f.provider.confirmPublication({ ...cue.value.request, epoch: 'wrong' }, publication(cue.result))).toBe(false);
    f.provider.discardPublication('wrong'); expect(f.provider.confirmPublication(cue.value.request, publication(cue.result))).toBe(false);
    const controller = new AbortController(), value = window(), result = await f.provider.decide(value, controller.signal);
    controller.abort(); expect(f.provider.confirmPublication(value.request, publication(result))).toBe(false);
    expect((await contextCue(f, 'clean')).input.recentPublishedReactions).toEqual([]);
  } finally { f.provider.close(); }
});
it('bounds publication context by entry count, characters and monotonic TTL, including delayed confirmation', async () => {
  for (const reply of ['short', 'x'.repeat(600)]) {
    let clock = 0; const f = fixture({ response: { ...retain, reply }, now: () => clock });
    try {
      for (let i = 0; i < 12; i++) { clock++; const cue = await contextCue(f, 'r' + i); expect(f.provider.confirmPublication(cue.value.request, publication(cue.result))).toBe(true); }
      const next = await contextCue(f, 'next'), entries = next.input.recentPublishedReactions;
      expect(entries).toHaveLength(reply.length === 600 ? 4 : 8); expect(entries.reduce((sum, row) => sum + row.reply.length, 0)).toBeLessThanOrEqual(2400);
      clock += 300000; expect((await contextCue(f, 'expired')).input.recentPublishedReactions).toEqual([]);
      const late = await contextCue(f, 'late'); clock += 60000;
      expect(f.provider.confirmPublication(late.value.request, publication(late.result))).toBe(false);
    } finally { f.provider.close(); }
  }
});
it('excludes rejected, unknown and mismatched publication receipts from the next model input', async () => {
  for (const patch of [{ reason: 'stale' }, { reason: 'transport_unknown' }, { requestId: 'other' }, { decisionId: 'other' }, { source: 'other' }, { chatPublished: false }]) {
    const f = fixture();
    try {
      const cue = await contextCue(f, 'rejected'); expect(f.provider.confirmPublication(cue.value.request, { ...publication(cue.result), ...patch })).toBe(false);
      expect((await contextCue(f, 'next')).input.recentPublishedReactions).toEqual([]);
    } finally { f.provider.close(); }
  }
});
it('drops pending publication context if staging time becomes nonfinite or rewinds before its start', async () => {
  for (const times of [[10, NaN, 20], [10, 5, 6]]) {
    let index = 0; const f = fixture({ now: () => times[Math.min(index++, times.length - 1)] });
    try { const cue = await contextCue(f, 'bad-clock'); expect(f.provider.confirmPublication(cue.value.request, publication(cue.result))).toBe(false); }
    finally { f.provider.close(); }
  }
});

it('carries observer-authored curves, patches, free RGB and bounded motion through the existing compose contract', async () => {
  const motion = { pivot: [0,0,0], translate: [0,0.1,0], rotate: [0,0,0.1], periodMs: 2000, phase: 0 };
  const parts = [
    { id: 'authored_stroke', kind: 'curve', points: [[-0.3,0,0],[0,0.4,0],[0.3,0,0]], radius: 0.025, weight: null, motion },
    { id: 'authored_plane', kind: 'patch', points: [[-0.3,-0.2,0],[0.3,-0.2,0],[0.2,0.1,0],[-0.2,0.1,0]], weight: null, motion: null },
  ];
  const response = { reply: '', decision: { mode: 'compose', reasonCode: 'authored_response', payload: { parts, base: 'none', durationMs: 500,
    easing: 'smoothstep', style: { color: '#71D3A9', brightness: 0.8, pointSize: 4, dispersion: 0.1 }, flow: null } } };
  const f = fixture({ response });
  try {
    const result = await f.provider.decide(window(), new AbortController().signal, undefined, { schemaVersion: 1, expressionAllowed: true });
    const children = result.decision.action.body.children;
    expect(children.find(node => node.type === 'assemble').parts).toEqual(parts.map(part => Object.fromEntries(Object.entries(part).filter(([,value]) => value !== null))));
    expect(children.find(node => node.type === 'style')).toMatchObject({ color: '#71D3A9' });
    expect(result.nativeProvenance.selectedMode).toBe('compose');
  } finally { f.provider.close(); }
});

it('freezes exact host permissions and rejects getters/extras before starting inference', async () => {
  expect(freezeNativeHostCapabilities()).toEqual({ schemaVersion: 1, expressionAllowed: false });
  expect(Object.isFrozen(freezeNativeHostCapabilities({ schemaVersion: 1, expressionAllowed: true }))).toBe(true);
  let reads = 0;
  for (const value of [null, { schemaVersion: 1, expressionAllowed: 1 }, { schemaVersion: 2, expressionAllowed: false },
    { schemaVersion: 1, expressionAllowed: false, private: 'forbidden' },
    { schemaVersion: 1, get expressionAllowed() { reads++; return true; } }]) {
    const f = fixture(); try {
      await expect(f.provider.decide(window(), new AbortController().signal, undefined, value)).rejects.toThrow('native_host_capabilities_invalid');
      expect(f.processes).toEqual([]);
    } finally { f.provider.close(); }
  }
  expect(reads).toBe(0);
});
it('hashes protected-form permission into Native input and rejects a mixed visual result as a whole', async () => {
  const f = fixture(), g = fixture();
  try {
    const protectedResult = await f.provider.decide(window(), new AbortController().signal, undefined, { schemaVersion: 1, expressionAllowed: false });
    const allowedResult = await g.provider.decide(window(), new AbortController().signal, undefined, { schemaVersion: 1, expressionAllowed: true });
    const input = JSON.parse(f.calls.find(call => call.method === 'turn/start').params.input[0].text);
    expect(input.hostCapabilities).toEqual({ schemaVersion: 1, expressionAllowed: false });
    expect(protectedResult.decision.mode).toBe('observe'); expect(protectedResult.nativeProvenance.inputHash).not.toBe(allowedResult.nativeProvenance.inputHash);
  } finally { f.provider.close(); g.provider.close(); }
  const mixed = fixture({ response: { reply: 'A caption must not leak through', decision: { mode: 'animate', reasonCode: 'subtle', payload: { controls: [], poses: [], lifetimeMs: 1000 } } } });
  try {
    await expect(mixed.provider.decide(window(), new AbortController().signal, undefined, { schemaVersion: 1, expressionAllowed: false })).rejects.toThrow('native_expression_not_allowed');
  } finally { mixed.provider.close(); }
});
it('captures Native expression permission as an immutable fourth provider argument without changing legacy calls', async () => {
  for (const native of [true, false]) {
    const calls = [], api = { activity() {}, configureReactive() {}, setReactiveUserBusy() {}, takeReactiveRequest: () => ({ request: window().request, observationWindow: window() }),
      authorizeReactiveRequest: () => true, nativeReactionCapabilities: () => ({ schemaVersion: 1, expressionAllowed: false }),
      deliverNativeReaction: () => ({}), deliverReactiveDecision: () => ({}) };
    const page = { evaluate: async (fn, args) => { const old = globalThis.window; globalThis.window = { fischLive: api }; try { return await fn(args); } finally { globalThis.window = old; } } };
    const broker = new LiveReactiveBroker({ page, output: {}, provider: { conversationLane: native, decide: async (...args) => { calls.push(args); return null; } }, forward() {}, reject() {} });
    await broker.poll({}); while (!calls.length) await new Promise(resolve => setImmediate(resolve));
    expect(calls[0]).toHaveLength(native ? 4 : 3);
    if (native) { expect(calls[0][3]).toEqual({ schemaVersion: 1, expressionAllowed: false }); expect(Object.isFrozen(calls[0][3])).toBe(true); }
    broker.close();
  }
});

it('drops a settled permission mismatch without retrying or permanently muting the conversation lane', async () => {
  const f = fixture({ response: { reply: 'must not publish', decision: { mode: 'animate', reasonCode: 'wrong_channel', payload: { controls: [], poses: [], lifetimeMs: 1000 } } } });
  try {
    const error = await f.provider.decide(window(), new AbortController().signal, undefined, { schemaVersion: 1, expressionAllowed: false }).catch(value => value);
    expect(error).toBeInstanceOf(ReactiveProviderError); expect(error).toMatchObject({ code: 'native_expression_not_allowed', transportSettled: true });
    for (const settled of [true, false]) {
      const delivered = [], failed = [], broker = new LiveReactiveBroker({ page: {}, output: {}, provider: { conversationLane: true }, forward() {}, reject() {} });
      broker.deliver = async (_id, value) => delivered.push(value); broker.fail = async id => failed.push(id);
      const owned = { id: 'r', terminal: false, controller: new AbortController() }; broker.active = owned;
      await broker.failed(owned, settled ? error : new ReactiveProviderError('native_expression_not_allowed', false));
      expect(broker.paused).toBe(!settled); expect(broker.uncertain).toBe(!settled);
      expect(delivered).toEqual(settled ? [null] : []); expect(failed).toEqual(settled ? [] : ['r']); broker.close();
    }
    expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
    expect(f.provider.uncertain).not.toBe(true);
  } finally { f.provider.close(); }
});

it('allows only one bounded confirmed-turn excerpt without granting geometry permission',()=>{
 const context={revision:1,submissionId:'submission-a',threadId:'thread-a',turnId:'turn-a',text:'Public current question',ageMs:100};
 const caps=freezeNativeHostCapabilities({schemaVersion:1,expressionAllowed:false,currentTurnContext:context});
 expect(caps.currentTurnContext).toEqual(context);expect(caps.expressionAllowed).toBe(false);context.text='changed';expect(caps.currentTurnContext.text).toBe('Public current question');
 for(const invalid of [{...context,text:'x'.repeat(241)},{...context,ageMs:60000},{...context,transcript:['PRIVATE']},{...context,get text(){throw Error('do not read');}}]){
  expect(()=>freezeNativeHostCapabilities({schemaVersion:1,expressionAllowed:false,currentTurnContext:invalid})).toThrow('native_host_capabilities_invalid');
 }
});

it('isolates inherited MCP servers at process startup and accepts only disabled empty registry rows', async () => {
  const empty = { name: 'fisch_live', tools: {}, resources: [], resourceTemplates: [] };
  const f = fixture({ inheritedMcp: true, catalog: [empty] });
  try {
    const result = await f.provider.decide(window(), new AbortController().signal);
    expect(result.nativeProvenance.mcpCatalogVerifiedEmpty).toBe(true);
    expect(f.processes).toHaveLength(2); expect(f.processes[0].closed).toBe(true);
    expect(f.processes[1].args).toContain('mcp_servers.fisch_live.enabled=false');
    expect(f.calls.filter(c => c.method === 'turn/start')).toHaveLength(1);
    const next = window(); next.request.requestId = 'second';
    await f.provider.decide(next, new AbortController().signal);
    expect(f.processes).toHaveLength(2);
  } finally { f.provider.close(); }
});

it('rejects unknown, enabled, paginated or capability-bearing observer catalogs', () => {
  const row = { name: 'known', tools: {}, resources: [], resourceTemplates: [] };
  expect(emptyObserverCapabilities({ data: [row], nextCursor: null }, ['known'])).toBe(true);
  for (const patch of [{ name: 'unknown' }, { tools: [] }, { tools: { command: {} } }, { resources: [{}] }, { resourceTemplates: [{}] }, { resources: undefined }])
    expect(emptyObserverCapabilities({ data: [{ ...row, ...patch }] }, ['known'])).toBe(false);
  expect(emptyObserverCapabilities({ data: [row, row] }, ['known'])).toBe(false);
  expect(emptyObserverCapabilities({ data: [], nextCursor: 'more' }, ['known'])).toBe(false);
  for (const enabled of [true, undefined, 0]) expect(() => verifyObserverServers({ mcp_servers: { known: { enabled } } }, ['known'])).toThrow();
  expect(() => verifyObserverServers({ mcp_servers: { unknown: { enabled: false } } }, ['known'])).toThrow();
  expect(() => observerServerArgs(['nested.name'])).toThrow();
});

it('does not respawn after unconfirmed discovery process settlement', async () => {
  const f = fixture({ inheritedMcp: true, confirmedClose: false });
  try {
    await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toThrow('native_reaction_isolation_unsettled');
    await expect(f.provider.decide(window(), new AbortController().signal)).rejects.toThrow('native_reaction_unavailable');
    expect(f.processes).toHaveLength(1);
    expect(f.calls.some(call => call.method === 'turn/start')).toBe(false);
  } finally { f.provider.close(); }
});
