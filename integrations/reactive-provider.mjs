import { beginReactiveReceipt } from './reactive-receipt.mjs';
import { freezeReactiveWindow } from './reactive-window.mjs';
import { parseReactiveResponse, reactiveSchema } from './reactive-decision.mjs';

export class ReactiveProviderError extends Error {
  constructor(code, transportSettled) { super(code); this.code = code; this.transportSettled = transportSettled; }
}
const failure = (code, settled) => new ReactiveProviderError(code, settled);
const instructions = 'Choose observe or a brief declarative particle expression based only on the supplied typed observations. ' +
  'Choose any #RRGGBB color with a smooth style.color transition when color helps communicate your response; there is no fixed emotion palette. Avoid flashing. ' +
  'Geometric estimates do not establish emotion or intent. Observe when evidence is insufficient. Return only the decision schema.';
const v2Instructions = instructions + ' Version 2 permits only brief generic symbolic expressions, not spatial illustrations. ' +
  'Set prerequisites to [] only when the expression remains appropriate across orientation, expression and hand-motion changes; otherwise list needed prerequisites or observe. ' +
  'Identity, presence, intent and critical track checks always apply and cannot be waived. validUntil is an admission deadline, never an execution lease.';
function endpoint(value) {
  let url; try { url = new URL(value); } catch { throw Error('reactive_endpoint_invalid'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw Error('reactive_endpoint_invalid');
  return url.href;
}
export function reactiveProviderConfig(env = {}) {
  const selected = env.FISCH_REACTIVE_CONTRACT_VERSION;
  if (selected !== undefined && !['1', '2'].includes(selected)) throw Error('reactive_contract_invalid');
  const contractVersion = selected === '2' ? 2 : 1;
  if (!env.FISCH_REACTIVE_BACKEND || env.FISCH_REACTIVE_BACKEND === 'off') return { enabled: false, reason: 'disabled_by_config' };
  if (env.FISCH_REACTIVE_BACKEND !== 'responses') throw Error('reactive_backend_invalid');
  const model = env.FISCH_REACTIVE_MODEL, url = env.FISCH_REACTIVE_URL, key = env.FISCH_REACTIVE_API_KEY;
  if (typeof model !== 'string' || !model.length || model.length > 128 || typeof url !== 'string')
    return { enabled: false, reason: 'missing_model_or_endpoint' };
  const address = endpoint(url);
  if (new URL(address).hostname === 'api.openai.com' && !key) return { enabled: false, reason: 'missing_api_key' };
  if (key !== undefined && (typeof key !== 'string' || !key.length || /[\r\n]/.test(key))) throw Error('reactive_key_invalid');
  return Object.freeze({ enabled: true, contractVersion, model, endpoint: address, ...(key ? { key } : {}) });
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
async function performReactiveRequest(request, address, options, frozen, receipt, contractVersion) {
  let payload, outcome = 'transport_unknown';
  try {
    let response;
    try { response = await request(address, options); } catch { throw failure('reactive_transport_unknown', false); }
    if (!response.ok) {
      outcome = 'http_error'; await response.body?.cancel().catch(() => {}); throw failure('reactive_provider_error', true);
    }
    outcome = 'invalid_response'; payload = await boundedJson(response);
    let decision;
    try { decision = parseReactiveResponse(payload, frozen.request, contractVersion); } catch { throw failure('reactive_decision_invalid', true); }
    outcome = 'completed'; return decision;
  } catch (error) {
    if (error instanceof ReactiveProviderError && error.transportSettled === false) outcome = 'transport_unknown';
    throw error;
  } finally { receipt?.(outcome, payload); }
}
export function reactiveResponsesAdapter(config, { reserve, fetch: request = fetch, now = () => performance.now() } = {}) {
  if (!config?.enabled) return null;
  if (typeof reserve !== 'function') throw Error('reactive_budget_required');
  const contractVersion = config.contractVersion ?? 1, schema = reactiveSchema(contractVersion);
  const address = endpoint(config.endpoint), model = config.model, key = config.key;
  if (typeof model !== 'string' || !model.length || model.length > 128 ||
      (new URL(address).hostname === 'api.openai.com' && !key) ||
      (key !== undefined && (typeof key !== 'string' || !key.length || /[\r\n]/.test(key)))) throw Error('reactive_config_invalid');
  const adapter = { async decide(window, signal, onReceipt) {
    let frozen;
    try { frozen = freezeReactiveWindow(window); } catch { throw failure('reactive_window_invalid', true); }
    if (frozen.request.schemaVersion !== contractVersion) throw failure('reactive_contract_mismatch', true);
    const body = JSON.stringify({ model, store: false, tools: [], tool_choice: 'none', max_output_tokens: 6000,
      instructions: contractVersion === 2 ? v2Instructions : instructions, input: JSON.stringify(frozen),
      text: { format: { type: 'json_schema', name: 'fisch_reactive_decision', strict: true, schema } } });
    if (signal?.aborted) throw failure('reactive_aborted', true);
    let reserved;
    try { reserved = await reserve(Object.freeze({ requestId: frozen.request.requestId })); } catch { throw failure('reactive_budget_denied', true); }
    if (reserved !== true) throw failure('reactive_budget_denied', true);
    if (signal?.aborted) throw failure('reactive_aborted', true);
    const receipt = beginReactiveReceipt(onReceipt, { requestId: frozen.request.requestId, address, body }, now);
    return performReactiveRequest(request, address, { method: 'POST', signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) }, body }, frozen, receipt, contractVersion);
  } };
  return Object.defineProperty(adapter, 'contractVersion', { value: contractVersion });
}
