import { freezeReactiveWindow } from './reactive-window.mjs';
import { parseReactiveResponse, reactiveDecisionSchema } from './reactive-decision.mjs';

export class ReactiveProviderError extends Error {
  constructor(code, transportSettled) { super(code); this.code = code; this.transportSettled = transportSettled; }
}
const failure = (code, settled) => new ReactiveProviderError(code, settled);
const instructions = 'Choose observe or a brief declarative particle expression based only on the supplied typed observations. ' +
  'Geometric estimates do not establish emotion or intent. Observe when evidence is insufficient. Return only the decision schema.';
function endpoint(value) {
  let url; try { url = new URL(value); } catch { throw Error('reactive_endpoint_invalid'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw Error('reactive_endpoint_invalid');
  return url.href;
}
export function reactiveProviderConfig(env = {}) {
  if (!env.FISCH_REACTIVE_BACKEND || env.FISCH_REACTIVE_BACKEND === 'off') return { enabled: false, reason: 'disabled_by_config' };
  if (env.FISCH_REACTIVE_BACKEND !== 'responses') throw Error('reactive_backend_invalid');
  const model = env.FISCH_REACTIVE_MODEL, url = env.FISCH_REACTIVE_URL, key = env.FISCH_REACTIVE_API_KEY;
  if (typeof model !== 'string' || !model.length || model.length > 128 || typeof url !== 'string')
    return { enabled: false, reason: 'missing_model_or_endpoint' };
  const address = endpoint(url);
  if (new URL(address).hostname === 'api.openai.com' && !key) return { enabled: false, reason: 'missing_api_key' };
  if (key !== undefined && (typeof key !== 'string' || !key.length || /[\r\n]/.test(key))) throw Error('reactive_key_invalid');
  return Object.freeze({ enabled: true, model, endpoint: address, ...(key ? { key } : {}) });
}
async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw failure('reactive_response_empty', true);
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 65536) throw failure('reactive_response_size', false);
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('reactive_response_json', true); }
  } catch (error) {
    if (error instanceof ReactiveProviderError) throw error;
    throw failure('reactive_response_read_unknown', false);
  } finally { await reader.cancel().catch(() => {}); }
}
export function reactiveResponsesAdapter(config, { reserve, fetch: request = fetch } = {}) {
  if (!config?.enabled) return null;
  if (typeof reserve !== 'function') throw Error('reactive_budget_required');
  const address = endpoint(config.endpoint), model = config.model, key = config.key;
  if (typeof model !== 'string' || !model.length || model.length > 128 ||
      (new URL(address).hostname === 'api.openai.com' && !key) ||
      (key !== undefined && (typeof key !== 'string' || !key.length || /[\r\n]/.test(key)))) throw Error('reactive_config_invalid');
  return { async decide(window, signal) {
    let frozen;
    try { frozen = freezeReactiveWindow(window); } catch { throw failure('reactive_window_invalid', true); }
    const body = JSON.stringify({ model, store: false, tools: [], tool_choice: 'none', max_output_tokens: 6000,
      instructions, input: JSON.stringify(frozen),
      text: { format: { type: 'json_schema', name: 'fisch_reactive_decision', strict: true, schema: reactiveDecisionSchema } } });
    if (signal?.aborted) throw failure('reactive_aborted', true);
    let reserved;
    try { reserved = await reserve(Object.freeze({ requestId: frozen.request.requestId })); } catch { throw failure('reactive_budget_denied', true); }
    if (reserved !== true) throw failure('reactive_budget_denied', true);
    if (signal?.aborted) throw failure('reactive_aborted', true);
    let response;
    try { response = await request(address, { method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) }, body }); }
    catch { throw failure('reactive_transport_unknown', false); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw failure('reactive_provider_error', true); }
    const payload = await boundedJson(response);
    try { return parseReactiveResponse(payload, frozen.request); } catch { throw failure('reactive_decision_invalid', true); }
  } };
}
