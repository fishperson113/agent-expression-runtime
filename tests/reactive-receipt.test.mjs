import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { freezeReactiveReceipt } from '../integrations/reactive-receipt.mjs';
import { reactiveResponsesAdapter } from '../integrations/reactive-provider.mjs';

const config = { enabled: true, model: 'private-model', endpoint: 'http://127.0.0.1:1/private-endpoint', key: 'PRIVATE_KEY' };
const window = () => ({ schemaVersion: 1, request: { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'r',
  intentRevision: 0, presenceRevision: 1, deadline: 1000, requiredTrackIds: [] }, events: [{ id: 1, type: 'user_arrived', at: 100 }],
  observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100, camera: 'absent', turn: 'idle', summary: 'PRIVATE_SUMMARY',
    user: { present: false, quality: { score: 0, basis: 'unavailable' }, position: null, head: null, facingScreen: null,
      expression: null, mouthMoving: null } }] });
const decision = { schemaVersion: 1, requestId: 'r', decisionId: 'd', mode: 'observe', validUntil: 900, action: null };
const payload = () => ({ status: 'completed', output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'PRIVATE_REASONING' }] },
  { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(decision) }] }],
  usage: { input_tokens: 17, output_tokens: 23, total_tokens: 40, private_extra: 'PRIVATE_USAGE' } });
function fixture(fetch, { reserve = async () => true, providerConfig = config } = {}) {
  let time = 100, clockCalls = 0; const receipts = [];
  const adapter = reactiveResponsesAdapter(providerConfig, { fetch, reserve, now: () => { clockCalls++; return time; } });
  return { adapter, receipts, receive: value => receipts.push(value), tick: value => { time = value; }, clockCalls: () => clockCalls };
}
const hash = value => createHash('sha256').update(value).digest('hex');
it('emits one immutable metadata-only success receipt after reservation and completed HTTP attempt', async () => {
  let body, reserved = false;
  const value = payload(), f = fixture(async (_url, options) => {
    expect(reserved).toBe(true); expect(f.receipts).toEqual([]); body = options.body; f.tick(145);
    return new Response(JSON.stringify(value));
  }, { reserve: async () => { reserved = true; expect(f.clockCalls()).toBe(0); return true; } });
  expect(await f.adapter.decide(window(), undefined, f.receive)).toEqual(decision);
  expect(f.receipts).toHaveLength(1); const receipt = f.receipts[0];
  expect(Object.keys(receipt).sort()).toEqual(['requestId', 'modelConfigHash', 'promptHash', 'requestHash', 'responseHash', 'outcome', 'durationMs', 'usage'].sort());
  expect(receipt.requestId).toBe('r'); expect(receipt.outcome).toBe('completed'); expect(receipt.durationMs).toBe(45);
  expect(receipt.requestHash).toBe(hash(body)); expect(receipt.responseHash).toBe(hash(JSON.stringify(value)));
  expect(receipt.usage).toEqual({ input_tokens: 17, output_tokens: 23, total_tokens: 40 });
  expect(Object.isFrozen(receipt)).toBe(true); expect(Object.isFrozen(receipt.usage)).toBe(true);
  expect(JSON.stringify(receipt)).not.toMatch(/PRIVATE_|private-model|private-endpoint|instructions|schema|Authorization/);
  for (const field of ['modelConfigHash', 'promptHash', 'requestHash', 'responseHash']) expect(receipt[field]).toMatch(/^[a-f0-9]{64}$/);
});
it('hashes credential-free configuration and only the actual sanitized request', async () => {
  const receipts = [];
  for (const key of ['PRIVATE_KEY', 'OTHER_KEY']) {
    const f = fixture(async () => new Response(JSON.stringify(payload())), { providerConfig: { ...config, key } });
    const input = window(); input.observations[0].summary = key;
    await f.adapter.decide(input, undefined, f.receive); receipts.push(f.receipts[0]);
  }
  for (const field of ['modelConfigHash', 'promptHash', 'requestHash']) expect(receipts[0][field]).toBe(receipts[1][field]);
  const f = fixture(async () => new Response(JSON.stringify(payload()))), input = window(); input.observations[0].seq = 2;
  await f.adapter.decide(input, undefined, f.receive);
  expect(f.receipts[0].requestHash).not.toBe(receipts[0].requestHash);
  expect(f.receipts[0].promptHash).toBe(receipts[0].promptHash);
});
it('records invalid bounded parsed responses with reported usage but never response text', async () => {
  const value = payload(); value.output[1].content[0].text = 'PRIVATE_UNRELATED_PROSE';
  const f = fixture(async () => new Response(JSON.stringify(value)));
  await expect(f.adapter.decide(window(), undefined, f.receive)).rejects.toMatchObject({ transportSettled: true });
  expect(f.receipts).toHaveLength(1); expect(f.receipts[0].outcome).toBe('invalid_response');
  expect(f.receipts[0].responseHash).toBe(hash(JSON.stringify(value)));
  expect(f.receipts[0].usage.total_tokens).toBe(40); expect(JSON.stringify(f.receipts)).not.toContain('PRIVATE_');
});
it('records one HTTP, network, read and oversized-stream outcome without inventing usage', async () => {
  const cases = [
    [async () => new Response('PRIVATE_HTTP_BODY', { status: 503 }), 'http_error', true],
    [async () => { throw Error('PRIVATE_NETWORK_ERROR'); }, 'transport_unknown', false],
    [async () => new Response(new ReadableStream({ start(controller) { controller.error(Error('PRIVATE_READ_ERROR')); } })), 'transport_unknown', false],
    [async () => new Response('x'.repeat(65537)), 'transport_unknown', false],
    [async () => new Response('PRIVATE_INVALID_JSON'), 'invalid_response', true],
  ];
  for (const [fetch, outcome, transportSettled] of cases) {
    const f = fixture(fetch); await expect(f.adapter.decide(window(), undefined, f.receive)).rejects.toMatchObject({ transportSettled });
    expect(f.receipts).toHaveLength(1); expect(f.receipts[0]).toMatchObject({ outcome, usage: 'unknown', responseHash: null });
    expect(JSON.stringify(f.receipts)).not.toContain('PRIVATE_');
  }
});
it('does no diagnostic work or callbacks for disabled capture or rejected preflight/budget', async () => {
  const off = fixture(async () => new Response(JSON.stringify(payload())));
  expect(await off.adapter.decide(window())).toEqual(decision); expect(off.clockCalls()).toBe(0);
  for (const change of ['budget', 'window', 'abort']) {
    let calls = 0; const f = fixture(async () => { calls++; return new Response(JSON.stringify(payload())); }, { reserve: async () => change !== 'budget' });
    const input = window(), controller = new AbortController();
    if (change === 'window') input.events = []; if (change === 'abort') controller.abort();
    await expect(f.adapter.decide(input, controller.signal, f.receive)).rejects.toThrow();
    expect(calls).toBe(0); expect(f.receipts).toEqual([]); expect(f.clockCalls()).toBe(0);
  }
});
it('isolates throwing, mutating and asynchronous callbacks from decisions and transport errors', async () => {
  for (const receive of [() => { throw Error('PRIVATE_CALLBACK_ERROR'); }, receipt => { receipt.usage.input_tokens = 999; },
    async () => { throw Error('PRIVATE_ASYNC_ERROR'); }]) {
    const f = fixture(async () => new Response(JSON.stringify(payload())));
    expect(await f.adapter.decide(window(), undefined, receive)).toEqual(decision);
    const failed = fixture(async () => { throw Error('PRIVATE_NETWORK_ERROR'); });
    await expect(failed.adapter.decide(window(), undefined, receive)).rejects.toMatchObject({ code: 'reactive_transport_unknown', transportSettled: false });
  }
});
it('keeps malformed or missing provider usage unknown rather than assuming zero', async () => {
  for (const usage of [undefined, { input_tokens: 1, output_tokens: 2 }, { input_tokens: -1, output_tokens: 2, total_tokens: 1 },
    { input_tokens: 1, output_tokens: 2.5, total_tokens: 3.5 }]) {
    const value = payload(); value.usage = usage;
    const f = fixture(async () => new Response(JSON.stringify(value))); await f.adapter.decide(window(), undefined, f.receive);
    expect(f.receipts[0].usage).toBe('unknown');
  }
});
it('does not claim sent HTTP after reservation-triggered abort or add a timer to an uncooperative transport', async () => {
  const before = new AbortController(); let calls = 0;
  const denied = fixture(async () => { calls++; return new Response(JSON.stringify(payload())); },
    { reserve: async () => { before.abort(); return true; } });
  await expect(denied.adapter.decide(window(), before.signal, denied.receive)).rejects.toMatchObject({ code: 'reactive_aborted', transportSettled: true });
  expect(calls).toBe(0); expect(denied.receipts).toEqual([]); expect(denied.clockCalls()).toBe(0);
  let complete, entered = false;
  const f = fixture(() => { entered = true; return new Promise(resolve => { complete = resolve; }); }), controller = new AbortController();
  const pending = f.adapter.decide(window(), controller.signal, f.receive);
  for (let i = 0; i < 8 && !entered; i++) await Promise.resolve();
  controller.abort(); expect(f.receipts).toEqual([]);
  complete(new Response(JSON.stringify(payload()))); expect(await pending).toEqual(decision);
  expect(f.receipts).toHaveLength(1); expect(f.receipts[0].outcome).toBe('completed');
});

it('projects strict cloned metadata and rejects raw fields, invalid values and accessors without invoking them', async () => {
  const f = fixture(async () => new Response(JSON.stringify(payload())));
  await f.adapter.decide(window(), undefined, f.receive);
  const raw = { ...f.receipts[0], usage: { ...f.receipts[0].usage } }, projected = freezeReactiveReceipt(raw);
  raw.usage.input_tokens = 999; expect(projected.usage.input_tokens).toBe(17);
  expect(projected).not.toBe(raw); expect(Object.isFrozen(projected.usage)).toBe(true);
  for (const patch of [{ endpoint: 'PRIVATE_ENDPOINT' }, { requestId: 'invalid:id' }, { promptHash: 'raw prompt' },
    { responseHash: 'not-hash' }, { outcome: 'custom' }, { durationMs: Infinity }, { durationMs: -1 },
    { usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3, privateText: 'PRIVATE_USAGE' } },
    { usage: { input_tokens: 1, output_tokens: 2, total_tokens: Number.MAX_SAFE_INTEGER + 1 } }])
    expect(() => freezeReactiveReceipt({ ...raw, ...patch })).toThrow('reactive_receipt_invalid');
  let reads = 0; const accessor = { ...raw };
  Object.defineProperty(accessor, 'promptHash', { get() { reads++; return 'PRIVATE_GETTER'; }, enumerable: true });
  expect(() => freezeReactiveReceipt(accessor)).toThrow('reactive_receipt_invalid'); expect(reads).toBe(0);
  const nested = { ...raw, usage: { ...raw.usage } };
  Object.defineProperty(nested.usage, 'input_tokens', { get() { reads++; return 1; }, enumerable: true });
  expect(() => freezeReactiveReceipt(nested)).toThrow('reactive_receipt_invalid'); expect(reads).toBe(0);
});
it('uses null rather than zero when the diagnostic duration cannot be measured', async () => {
  const receipts = [], adapter = reactiveResponsesAdapter(config, { reserve: async () => true,
    fetch: async () => new Response(JSON.stringify(payload())), now: () => NaN });
  expect(await adapter.decide(window(), undefined, receipt => receipts.push(receipt))).toEqual(decision);
  expect(receipts).toHaveLength(1); expect(receipts[0].durationMs).toBe(null);
});
