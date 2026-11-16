import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { optionalSelectorPresentation, selectorSource, SelectorFinalSource, SelectorPresentationProvider } from '../integrations/selector-presentation.mjs';

const input = (text = 'A public answer.', completed = false, at = 10) => ({ documentId: 'd', threadId: 't', turnId: 'turn', messageId: 'm', text, completed, at });
const digest = value => createHash('sha256').update(`Public context:\n${value.publicContext}\nCurrent text:\n${value.target}`).digest('hex');
function fixture() {
  let source = { documentId: 'd', threadId: 't', generation: 1, revision: 4, turnId: 'turn', messageId: 'm',
    role: 'assistant', target: 'Do not deploy until tests pass.', publicContext: 'Tests have not passed.' };
  const fallback = { generate: vi.fn(), close: vi.fn() };
  const client = { score: vi.fn(async value => ({ selected: ['a01'], sourceHash: digest(value) })), close: vi.fn(async () => {}),
    library: { catalog: [{ id: 'a01', sha256: 'hash' }], parseRecord: vi.fn(() => ({ mode: 'compose' })) } };
  const callbacks = { isCurrent: vi.fn(() => true), onRecord: vi.fn() }, controller = new AbortController();
  const provider = new SelectorPresentationProvider({ fallback, client, snapshot: () => source });
  return { provider, fallback, client, callbacks, controller, source, set: value => { source = value; },
    run: () => provider.generate({ target: source.target }, controller.signal, {}, callbacks) };
}

it('keeps the optional runtime off without config and never boots it', async () => {
  const bootstrap = vi.fn(), state = { logs: [] };
  expect(await optionalSelectorPresentation({ state, env: {}, bootstrap })).toBeNull();
  expect(bootstrap).not.toHaveBeenCalled(); expect(state.logs).toEqual([]);
});
it('locks ordinary behavior on bootstrap failure and reports no private error details', async () => {
  const state = { logs: [] }, bootstrap = vi.fn(async () => { throw Error('private path and input'); });
  expect(await optionalSelectorPresentation({ state, env: { FISCH_EXPERIMENTAL_SELECTOR_MANIFEST: '/bundle.json' }, bootstrap })).toBeNull();
  expect(state.logs.join()).toContain('ordinary visual lane retained'); expect(state.logs.join()).not.toContain('private');
});
it('never starts local selector for diagram mode', async () => {
  const bootstrap = vi.fn();
  expect(await optionalSelectorPresentation({ state: { logs: [] }, env: { FISCH_EXPERIMENTAL_SELECTOR_MANIFEST: '/bundle', FISCH_PRESENTATION_PROTOCOL: 'diagram' }, bootstrap })).toBeNull();
  expect(bootstrap).not.toHaveBeenCalled();
});
it('fixes the enabled sampler and provider only after a ready bootstrap', async () => {
  let ready; const bootstrap = vi.fn(() => new Promise(resolve => { ready = resolve; }));
  const state = { logs: [], conversation: { snapshot: () => ({ generation: 1 }) } }, client = { close: vi.fn(async () => {}) };
  const promise = optionalSelectorPresentation({ state, env: { FISCH_EXPERIMENTAL_SELECTOR_MANIFEST: '/bundle' }, bootstrap, fallbackFactory: () => ({}) });
  expect(state.logs).toEqual([]); await Promise.resolve(); ready(client); const result = await promise;
  expect(result.sampler).toBeInstanceOf(SelectorFinalSource); expect(result.provider).toBeInstanceOf(SelectorPresentationProvider);
});
it('samples whole final source without renewing first observed time', () => {
  const sampler = new SelectorFinalSource(() => 1);
  expect(sampler.update(input()).checkpoint).toBeNull();
  const cp = sampler.update(input('A public answer.', true, 500)).checkpoint;
  expect(cp.sourceAt).toBe(10); expect(cp.observedAt).toBe(10); expect(cp.target).toBe(cp.textPrefix);
  expect(sampler.update(input('A public answer.', true, 900)).checkpoint).toBeNull();
  sampler.revoke(); expect(sampler.update(input('A public answer.', true, 1000)).reason).toBe('source_revoked');
});
it('permanently fences corrections, terminal regression, malformed source and generation reuse', () => {
  for (const changed of [input('Changed.', true, 20), input('A public answer.', false, 20), { ...input(), text: null }]) {
    const sampler = new SelectorFinalSource(() => 1); sampler.update(input('A public answer.', true, 10));
    expect(sampler.update(changed).revoked).toBe(true);
    expect(sampler.update(input('A public answer.', true, 30)).reason).toBe('source_revoked');
  }
  let generation = 1; const sampler = new SelectorFinalSource(() => generation); sampler.update(input());
  generation = 2; expect(sampler.update(input('New generation.', true, 20)).checkpoint.sourceAt).toBe(20);
  generation = 1; expect(sampler.update(input('A public answer.', true, 30)).reason).toBe('source_revoked');
});
it('rejects source-capacity overflow instead of reminting an old source', () => {
  const sampler = new SelectorFinalSource(() => 1);
  for (let i = 0; i < 64; i++) sampler.update({ ...input(), messageId: 'm' + i });
  expect(sampler.update({ ...input(), messageId: 'overflow' }).reason).toBe('source_capacity');
  expect(sampler.update({ ...input('A public answer.', true), messageId: 'm63' }).reason).toBe('source_revoked');
});
it('reads only full public assistant context and rejects truncated or mismatched ownership', () => {
  const messages = [{ id: 'prior', turn: 'old', role: 'assistant', text: 'Only if tests pass.' },
    { id: 'tool', role: 'tool', text: 'private tool' }, { id: 'user', role: 'user', turn: 'turn', text: 'private user' },
    { id: 'm', role: 'assistant', turn: 'turn', text: 'Do not deploy.', status: 'completed' }];
  const snapshot = { threadId: 't', generation: 1, revision: 4, messages };
  const state = { channel: { token: 'd' }, conversation: { snapshot: () => snapshot } };
  expect(selectorSource(state).publicContext).toBe('Only if tests pass.');
  snapshot.ownerTurn = 'different'; expect(selectorSource(state)).toBeNull(); snapshot.ownerTurn = null;
  messages[0].truncated = true; expect(selectorSource(state)).toBeNull();
});
it('returns a canonical asset through onRecord exactly once with no slow author', async () => {
  const f = fixture(); await f.run(); expect(f.callbacks.onRecord).toHaveBeenCalledOnce();
  expect(f.fallback.generate).not.toHaveBeenCalled(); expect(f.client.library.parseRecord).toHaveBeenCalledOnce();
});
it('preserves full qualifying context in sequential abstain, ambiguous, error and oversize fallback', async () => {
  for (const outcome of [[], ['a01', 'a02'], null]) {
    const f = fixture(); f.client.score.mockImplementation(async value => { if (outcome === null) throw Error('too_long'); return { selected: outcome, sourceHash: digest(value) }; });
    await f.run(); expect(f.callbacks.onRecord).not.toHaveBeenCalled(); expect(f.fallback.generate).toHaveBeenCalledOnce();
    expect(f.fallback.generate.mock.calls[0][0]).toMatchObject({ publicContext: f.source.publicContext, target: f.source.target });
    expect(f.fallback.generate.mock.calls[0][1]).toBe(f.controller.signal);
  }
});
it('cannot silently trim context before slow fallback', async () => {
  const f = fixture(); f.set({ ...f.source, publicContext: 'x'.repeat(4097) });
  f.client.score.mockRejectedValue(Error('too_long')); await expect(f.run()).rejects.toThrow('context_capacity');
  expect(f.fallback.generate).not.toHaveBeenCalled();
});
it('rejects wrong score hash without fallback or admission', async () => {
  const f = fixture(); f.client.score.mockResolvedValue({ selected: ['a01'], sourceHash: 'wrong' });
  await expect(f.run()).rejects.toThrow('source_hash'); expect(f.callbacks.onRecord).not.toHaveBeenCalled(); expect(f.fallback.generate).not.toHaveBeenCalled();
});
it('drops late selection on cancellation, source revision change or expired authority', async () => {
  for (const change of ['cancel', 'revision', 'expired']) {
    const f = fixture(); f.client.score.mockImplementation(async value => {
      if (change === 'cancel') f.controller.abort();
      if (change === 'revision') f.set({ ...f.source, revision: 5 });
      if (change === 'expired') f.callbacks.isCurrent.mockReturnValue(false);
      return { selected: ['a01'], sourceHash: digest(value) };
    });
    await expect(f.run()).rejects.toThrow('source_stale'); expect(f.callbacks.onRecord).not.toHaveBeenCalled(); expect(f.fallback.generate).not.toHaveBeenCalled();
  }
});
it('closes a late ready worker after session cancellation instead of installing it', async () => {
  let ready; const bootstrap = vi.fn(() => new Promise(resolve => { ready = resolve; }));
  const controller = new AbortController(), client = { close: vi.fn(async () => {}) }, fallbackFactory = vi.fn();
  const pending = optionalSelectorPresentation({ state: { logs: [] }, env: { FISCH_EXPERIMENTAL_SELECTOR_MANIFEST: '/bundle' }, signal: controller.signal, bootstrap, fallbackFactory });
  await Promise.resolve(); controller.abort(); expect(await pending).toBeNull();
  ready(client); await vi.waitFor(() => expect(client.close).toHaveBeenCalledOnce()); expect(fallbackFactory).not.toHaveBeenCalled();
});
import { LiveStreamingPresentationBridge } from '../integrations/presentation-streaming-bridge.mjs';
function realBridgeFixture() {
  let now = 1000, accept; const calls = [];
  const snapshot = { available: true, threadId: 'h', generation: 1, revision: 1, ownerTurn: 't', messages: [
    { id: 'u', turn: 't', role: 'user', status: 'completed', text: 'A game.' },
    { id: 'a', turn: 't', role: 'assistant', status: 'streaming', text: 'Let us play a tiny game.', truncated: false }] };
  const state = { channel: { token: 'd' }, output: { thread: 'h' }, conversation: { snapshot: () => snapshot } };
  const page = { evaluate: async (fn, arg) => {
    calls.push({ fn: String(fn), arg });
    if (String(fn).includes('presentationPreparationTicket')) return { intentVersion: 0, preparationVersion: 1 };
    if (arg?.body) return new Promise(resolve => { accept = resolve; });
    if (arg?.identity) return { scope: { epoch: 'e', sceneRevision: 1 }, partIds: [] };
  } };
  const client = { close: async () => {}, score: async value => ({ selected: ['a01'], sourceHash: digest(value) }),
    library: { catalog: [{ id: 'a01', sha256: 'x' }], parseRecord: () => ({ mode: 'compose', payload: { base: 'none', durationMs: 100,
      parts: [{ id: 'fish', kind: 'ellipsoid', center: [0, 0, 0], scale: [.5, .5, .5] }] } }) } };
  const provider = new SelectorPresentationProvider({ client, fallback: { close() {}, generate: vi.fn() }, snapshot: () => selectorSource(state) });
  const bridge = new LiveStreamingPresentationBridge({ state, page, provider, now: () => now, boundedSourceLease: true, ttlMs: 10000 });
  bridge.checkpoints = new SelectorFinalSource(() => snapshot.generation);
  const send = (method, item) => bridge.observe({ method, params: { threadId: 'h', turnId: 't', item } });
  send('item/started', { id: 'a', type: 'agentMessage', phase: 'final_answer' });
  send('item/agentMessage/delta');
  return { bridge, calls, snapshot, accept: value => accept(value), complete() {
    now = 1500; snapshot.messages[1].status = 'completed'; snapshot.ownerTurn = null; snapshot.revision++;
    send('item/completed', { id: 'a', type: 'agentMessage', phase: 'final_answer' });
  } };
}
it('uses the actual bridge with original browser deadline and exact late receipt cleanup', async () => {
  const f = realBridgeFixture(); f.complete();
  try {
    await vi.waitFor(() => expect(f.calls.some(call => call.arg?.body)).toBe(true));
    const prepared = f.calls.find(call => call.arg?.identity).arg;
    expect(prepared.expiresAt).toBe(11000); expect(prepared.remainingMs).toBeLessThanOrEqual(9500);
    expect(prepared.identity.sourceQuote).toBe('Let us play a tiny game.');
    f.snapshot.ownerTurn = 'new-turn'; f.bridge.invalidate();
    f.accept({ status: 'accepted', epoch: 'e', sceneRevision: 2, seq: 9 });
    await vi.waitFor(() => expect(f.calls.filter(call => call.fn.includes('revokeOwnedPresentation')).some(call =>
      JSON.stringify(call.arg) === JSON.stringify({ epoch: 'e', sceneRevision: 2, seq: 9 }))).toBe(true));
    expect(f.calls.filter(call => call.arg?.body)).toHaveLength(1);
  } finally { f.bridge.close(); }
});
