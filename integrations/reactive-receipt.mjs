import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
function reportedUsage(payload) {
  const usage = payload?.usage, fields = ['input_tokens', 'output_tokens', 'total_tokens'];
  if (!usage || fields.some(field => !Number.isSafeInteger(usage[field]) || usage[field] < 0)) return 'unknown';
  return Object.freeze(Object.fromEntries(fields.map(field => [field, usage[field]])));
}
const fields = ['requestId', 'modelConfigHash', 'promptHash', 'requestHash', 'responseHash', 'outcome', 'durationMs', 'usage'];
const tokenFields = ['input_tokens', 'output_tokens', 'total_tokens'];
function dataObject(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('reactive_receipt_invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value')))
    throw Error('reactive_receipt_invalid');
  return Object.fromEntries(allowed.map(key => [key, descriptors[key].value]));
}
export function freezeReactiveReceipt(value) {
  try {
    const receipt = dataObject(value, fields), hashValue = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    if (typeof receipt.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(receipt.requestId) ||
        !['modelConfigHash', 'promptHash', 'requestHash'].every(key => hashValue(receipt[key])) ||
        (receipt.responseHash !== null && !hashValue(receipt.responseHash)) ||
        !['completed', 'invalid_response', 'http_error', 'transport_unknown'].includes(receipt.outcome) ||
        (receipt.durationMs !== null && (typeof receipt.durationMs !== 'number' || !Number.isFinite(receipt.durationMs) ||
          receipt.durationMs < 0 || receipt.durationMs > Number.MAX_SAFE_INTEGER))) throw Error('reactive_receipt_invalid');
    if (receipt.usage !== 'unknown') {
      const usage = dataObject(receipt.usage, tokenFields);
      if (tokenFields.some(key => !Number.isSafeInteger(usage[key]) || usage[key] < 0)) throw Error('reactive_receipt_invalid');
      receipt.usage = Object.freeze(usage);
    }
    return Object.freeze(receipt);
  } catch { throw Error('reactive_receipt_invalid'); }
}
export function beginReactiveReceipt(callback, { requestId, address, body }, now) {
  if (typeof callback !== 'function') return undefined;
  let fixed, started;
  try {
    const sent = JSON.parse(body);
    fixed = { requestId, modelConfigHash: hash(JSON.stringify({ model: sent.model, endpoint: address,
      capabilities: { tools: sent.tools, tool_choice: sent.tool_choice, max_output_tokens: sent.max_output_tokens } })),
      promptHash: hash(JSON.stringify({ instructions: sent.instructions, text: sent.text })), requestHash: hash(body) };
    started = now();
  } catch { return undefined; }
  let emitted = false;
  return (outcome, payload) => {
    if (emitted) return; emitted = true;
    try {
      const elapsed = now() - started;
      const receipt = freezeReactiveReceipt({ ...fixed, responseHash: payload === undefined ? null : hash(JSON.stringify(payload)),
        outcome, durationMs: Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= Number.MAX_SAFE_INTEGER ? elapsed : null, usage: reportedUsage(payload) });
      const pending = callback(receipt);
      if (pending !== undefined) void Promise.resolve(pending).catch(() => {});
    } catch { /* Receipt handling cannot change a decision or its transport outcome. */ }
  };
}
