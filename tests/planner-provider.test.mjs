import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { plannerConfig, modelPlanner } from '../integrations/planner-provider.mjs';
import { paneActivity } from '../integrations/planner-bridge.mjs';
import { terminalEngine } from '../scripts/pane-session.mjs';
import { planSchema } from '../integrations/expression-plan.mjs';

const absent = new URL('../.runtime/no-planner-env', import.meta.url);
const plan = { body: { type: 'sequence', children: [{ type: 'parallel', children: [
  { type: 'morph', target: 'wave', durationMs: 200 },
] }] } };
const result = value => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
it('keeps all nested geometry objects compatible with strict structured outputs', () => {
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'object') {
      expect(value.additionalProperties).toBe(false);
      expect([...value.required].sort()).toEqual(Object.keys(value.properties).sort());
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit); else visit(child);
    }
  }
  visit(planSchema);
});
it('requires explicit model config, protects credentials and permits local inference', () => {
  expect(plannerConfig({}, absent).backend).toBe('codex');
  const local = plannerConfig({ FISCH_PLANNER_BACKEND: 'api', FISCH_PLANNER_MODEL: 'test', FISCH_PLANNER_URL: 'http://127.0.0.1:8000/v1/responses', OPENAI_API_KEY: 'private' }, absent);
  expect(local.enabled).toBe(true); expect(local.key).toBeUndefined();
  expect(() => plannerConfig({ FISCH_PLANNER_BACKEND: 'api', FISCH_PLANNER_MODEL: 'test', FISCH_PLANNER_URL: 'http://remote.invalid/v1/responses' }, absent)).toThrow();
  expect(() => plannerConfig({ FISCH_PLANNER_BACKEND: 'api', FISCH_PLANNER_MODEL: 'test', FISCH_PLANNER_URL: 'https://host.invalid/?key=private' }, absent)).toThrow();
  expect(plannerConfig({ FISCH_PLANNER_BACKEND: 'api', FISCH_PLANNER_MODEL: 'test', FISCH_PLANNER_URL: 'https://api.openai.com/v1/responses' }, absent).reason).toBe('missing_api_key');
});
it('runs pane context through HTTP structured planning into the actual compiler', async () => {
  let request;
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    request = JSON.parse(text); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result(plan)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const engine = await terminalEngine(); let reads = 0;
  const activity = paneActivity(engine, { pane_id: 'agent-pane' }, async (method, args) => {
    expect(method).toBe('pane.read'); expect(args.pane_id).toBe('agent-pane'); reads++;
    return { read: { text: 'We found a promising solution. token=private' } };
  }, { enabled: true, model: 'fake-local-model', endpoint: `http://127.0.0.1:${server.address().port}/v1/responses` });
  try {
    activity.update('working'); activity.tick();
    for (let i = 0; i < 100 && activity.planner.applied === 0 && activity.planner.mode !== 'fallback'; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(activity.planner.applied).toBe(1); expect(reads).toBe(1);
    expect(request.store).toBe(false); expect(request.text.format.strict).toBe(true);
    expect(request.input).toContain('[REDACTED]'); expect(request.input).not.toContain('private');
    expect(request.model).toBe('fake-local-model');
  } finally { activity.close(); engine.dispose(); await new Promise(resolve => server.close(resolve)); }
});
it('rejects refusals, incomplete or oversized responses without admitting programs', async () => {
  const config = { enabled: true, model: 'fake', endpoint: 'http://localhost/v1/responses' };
  for (const payload of [{ status: 'incomplete' }, { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }, 'x'.repeat(70000)]) {
    const plan = modelPlanner(config, async () => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload)));
    await expect(plan({ visibleContext: 'test' }, new AbortController().signal)).rejects.toThrow();
  }
});
