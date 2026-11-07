import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { planSchema, plannerInstructions } from './expression-plan.mjs';

export function plannerConfig(env = process.env, file = new URL('../.env', import.meta.url), agent = {}) {
  const values = { ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}), ...env };
  const backend = values.FISCH_PLANNER_BACKEND ?? (agent.agent?.startsWith('claude') ? 'claude' : 'codex');
  if (backend === 'off') return { enabled: false, reason: 'disabled_by_config' };
  const model = values.FISCH_PLANNER_MODEL;
  if (['codex', 'claude'].includes(backend)) return { enabled: true, backend, model, command: values.FISCH_PLANNER_COMMAND };
  if (backend !== 'api') throw Error('Unknown Fisch planner backend.');
  const endpoint = values.FISCH_PLANNER_URL ?? (values.OPENAI_API_KEY ? 'https://api.openai.com/v1/responses' : undefined);
  if (!model || !endpoint) return { enabled: false, reason: 'missing_model_or_endpoint' };
  const url = new URL(endpoint), local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:')))
    throw Error('Planner URL requires HTTPS or local HTTP, without embedded credentials.');
  const key = values.FISCH_PLANNER_API_KEY ?? (url.hostname === 'api.openai.com' ? values.OPENAI_API_KEY : undefined);
  if (url.hostname === 'api.openai.com' && !key) return { enabled: false, reason: 'missing_api_key' };
  return { enabled: true, backend, model, endpoint: url.href, key };
}

async function boundedJson(response) {
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) throw Error('provider_response_too_large');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export function modelPlanner(config, request = fetch) {
  if (!config.enabled) return null;
  return async (context, signal) => {
    const response = await request(config.endpoint, { method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) },
      body: JSON.stringify({ model: config.model, store: false, max_output_tokens: 6000,
        instructions: plannerInstructions, input: JSON.stringify(context),
        text: { format: { type: 'json_schema', name: 'fisch_expression', strict: true, schema: planSchema } } }),
    });
    if (!response.ok) { await response.body?.cancel(); throw Error('provider_error'); }
    const result = await boundedJson(response);
    if (result.status !== 'completed') throw Error('incomplete_plan');
    const content = result.output?.flatMap(item => item.content ?? []) ?? [];
    if (content.some(item => item.type === 'refusal')) throw Error('plan_refused');
    const text = content.filter(item => item.type === 'output_text').map(item => item.text).join('');
    return JSON.parse(text);
  };
}
