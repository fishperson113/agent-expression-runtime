import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { reactiveProviderConfig, reactiveResponsesAdapter } from '../integrations/reactive-provider.mjs';
import { freezeReactiveWindow } from '../integrations/reactive-window.mjs';
import { reactiveDecisionSchema } from '../integrations/reactive-decision.mjs';

const config = { enabled: true, model: 'fake', endpoint: 'http://127.0.0.1/v1/responses' };
const window = () => ({ schemaVersion: 1, request: { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'r',
  intentRevision: 0, deadline: 1000, requiredTrackIds: [], presenceRevision: 1 }, events: [{ id: 1, type: 'user_arrived', at: 100 }],
  observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100, camera: 'absent', turn: 'idle', summary: 'PRIVATE_CODING_CONTEXT',
    user: { present: false, quality: { score: 0, basis: 'unavailable' }, position: null, head: null, facingScreen: null,
      expression: null, mouthMoving: null } }] });
const decision = () => ({ schemaVersion: 1, requestId: 'r', decisionId: 'd', mode: 'observe', validUntil: 900, action: null });
const response = (value = decision(), extra = []) => ({ status: 'completed', output: [...extra, { type: 'message',
  role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const mock = value => async () => new Response(typeof value === 'string' ? value : JSON.stringify(value));
const adapter = (fetch, reserve = async () => true) => reactiveResponsesAdapter(config, { fetch, reserve });
it('defaults off and never auto-enables API credentials or another planner backend', () => {
  expect(reactiveProviderConfig({ OPENAI_API_KEY: 'private', FISCH_PLANNER_BACKEND: 'api' }).enabled).toBe(false);
  expect(reactiveResponsesAdapter({ enabled: false })).toBe(null);
  expect(reactiveProviderConfig({ FISCH_REACTIVE_BACKEND: 'responses' }).enabled).toBe(false);
  expect(reactiveProviderConfig({ FISCH_REACTIVE_BACKEND: 'responses', FISCH_REACTIVE_MODEL: 'fake',
    FISCH_REACTIVE_URL: 'https://api.openai.com/v1/responses', OPENAI_API_KEY: 'private' }).reason).toBe('missing_api_key');
  for (const url of ['http://remote.invalid', 'https://x.invalid?key=private', 'https://user:pass@x.invalid'])
    expect(() => reactiveProviderConfig({ FISCH_REACTIVE_BACKEND: 'responses', FISCH_REACTIVE_MODEL: 'fake', FISCH_REACTIVE_URL: url })).toThrow('reactive_endpoint_invalid');
  expect(() => reactiveResponsesAdapter(config)).toThrow('reactive_budget_required');
});
it('validates and freezes the typed window, removes summary and rejects unknown coding context', () => {
  const frozen = freezeReactiveWindow(window());
  expect(JSON.stringify(frozen)).not.toContain('PRIVATE_CODING_CONTEXT');
  expect(Object.isFrozen(frozen.observations[0].user)).toBe(true);
  for (const patch of [{ transcript: 'private' }, { events: Array(9).fill(window().events[0]) },
    { observations: Array(5).fill(window().observations[0]) }, { request: { ...window().request, conversation: 'coding' } }])
    expect(() => freezeReactiveWindow({ ...window(), ...patch })).toThrow();
  const invalid = window(); invalid.observations[0].user.code = 'run()';
  expect(() => freezeReactiveWindow(invalid)).toThrow('reactive_window_invalid');
});
it('sends stateless tools-free fixed HTTP and reserves once before dispatch', async () => {
  let received, reserved = 0;
  const server = createServer(async (req, res) => {
    let bytes = ''; for await (const part of req) bytes += part;
    received = { body: JSON.parse(bytes), headers: req.headers }; res.end(JSON.stringify(response()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const provider = reactiveResponsesAdapter({ ...config, endpoint: `http://127.0.0.1:${server.address().port}/v1/responses`, key: 'test-only' },
      { reserve: async value => { expect(value).toEqual({ requestId: 'r' }); reserved++; return true; } });
    expect(await provider.decide(window(), new AbortController().signal)).toEqual(decision());
    expect(reserved).toBe(1); expect(received.body.tools).toEqual([]); expect(received.body.tool_choice).toBe('none');
    expect(received.body.store).toBe(false); expect(received.body.text.format.strict).toBe(true);
    expect(Object.keys(received.body).sort()).toEqual(['model', 'store', 'tools', 'tool_choice', 'max_output_tokens', 'instructions', 'input', 'text'].sort());
    expect(JSON.stringify(received.body)).not.toMatch(/PRIVATE_CODING_CONTEXT|previous_response_id|conversation|AER_PAIRING/);
    expect(received.headers.authorization).toBe('Bearer test-only');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
it('does not fetch on invalid windows, missing/denied budget or cancelled signal', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return new Response(JSON.stringify(response())); };
  await expect(adapter(fetch, async () => false).decide(window())).rejects.toThrow('reactive_budget_denied');
  const controller = new AbortController(); controller.abort();
  await expect(adapter(fetch).decide(window(), controller.signal)).rejects.toThrow('reactive_aborted');
  await expect(adapter(fetch).decide({ ...window(), transcript: 'private' })).rejects.toThrow('reactive_window_invalid');
  expect(calls).toBe(0);
});
it('never retries unknown transport errors and uses only explicit headers/redirect policy', async () => {
  let calls = 0, reserves = 0;
  const provider = adapter(async (_url, options) => {
    calls++; expect(options.redirect).toBe('error'); expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    throw Error('private upstream text');
  }, async () => { reserves++; return true; });
  await expect(provider.decide(window())).rejects.toThrow('reactive_transport_unknown');
  expect(calls).toBe(1); expect(reserves).toBe(1);
});
it('accepts bounded reasoning metadata without forwarding it and permits finite authored DSL', async () => {
  const body = { type: 'sequence', children: [{ type: 'parallel', children: [{ type: 'morph', target: 'sphere', durationMs: 500 }] }] };
  const value = { ...decision(), mode: 'express', action: { actionId: 'a', body } };
  const result = await adapter(mock(response(value, [{ type: 'reasoning', id: 'private', summary: [] }]))).decide(window());
  expect(result).toEqual(value); expect(JSON.stringify(result)).not.toContain('private');
});
it('rejects tools, refusals, prose, incomplete, oversized and mismatched responses', async () => {
  const message = response().output[0];
  const cases = [{ status: 'incomplete', output: [] }, response({ ...decision(), requestId: 'other' }),
    response({ ...decision(), validUntil: 1001 }), response({ ...decision(), text: 'unrelated Python' }),
    response({ ...decision(), mode: 'express', action: { actionId: 'a', body: { type: 'script', code: 'run()' } } }),
    { status: 'completed', output: [message, message] }, response(decision(), [{ type: 'function_call', name: 'exec', arguments: '{}' }]),
    { status: 'completed', output: [{ ...message, content: [{ type: 'refusal', refusal: 'no' }] }] },
    { status: 'completed', output: [{ ...message, content: [{ type: 'output_text', text: 'unrelated prose' }] }] }, 'x'.repeat(65537)];
  for (const value of cases) await expect(adapter(mock(value)).decide(window())).rejects.toThrow();
});
it('keeps every generated strict decision schema object closed with all fields required', () => {
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'object') {
      expect(value.additionalProperties).toBe(false);
      expect([...value.required].sort()).toEqual(Object.keys(value.properties).sort());
    }
    for (const item of Object.values(value)) Array.isArray(item) ? item.forEach(visit) : visit(item);
  }
  visit(reactiveDecisionSchema);
});
it('marks only preflight and completed failures as transport-settled', async () => {
  const settled = [adapter(mock(response()), async () => false).decide(window()),
    adapter(mock({ status: 'incomplete' })).decide(window()),
    adapter(async () => new Response('unavailable', { status: 503 })).decide(window())];
  for (const promise of settled) await expect(promise).rejects.toMatchObject({ transportSettled: true });
  const unknown = [adapter(async () => { throw Error('network'); }).decide(window()),
    adapter(mock('x'.repeat(65537))).decide(window()),
    adapter(async () => new Response(new ReadableStream({ start(controller) { controller.error(Error('read')); } }))).decide(window())];
  for (const promise of unknown) await expect(promise).rejects.toMatchObject({ transportSettled: false });
});
