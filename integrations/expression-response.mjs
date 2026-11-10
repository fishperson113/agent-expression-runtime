import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import { compositionSchema, composeExpression } from './compose-expression.mjs';
const live = JSON.parse(readFileSync(new URL('../src/contracts/live-control.schema.json', import.meta.url), 'utf8'));
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
function strictOptional(value) {
  if (Array.isArray(value)) return value.map(strictOptional);
  if (!value || typeof value !== 'object') return value;
  const copy = Object.fromEntries(Object.entries(value).filter(([key]) => !['default', 'minProperties'].includes(key)).map(([key, item]) => [key, strictOptional(item)]));
  if (copy.type === 'object') {
    const required = new Set(value.required ?? []);
    for (const key of Object.keys(copy.properties ?? {})) if (!required.has(key)) copy.properties[key] = { anyOf: [copy.properties[key], { type: 'null' }] };
    copy.required = Object.keys(copy.properties ?? {});
  }
  return copy;
}
function withoutNulls(value) {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, withoutNulls(v)]));
}
const { requestId, expectedEpoch, ...geometry } = compositionSchema.properties;
const configuration = structuredClone(live.$defs.configuration); configuration.properties.lifetimeMs.maximum = 10000;
const reasonCode = { type: 'string', maxLength: 48, pattern: '^[a-z0-9_-]+$', description: 'Short audit label, not private reasoning or an emotional diagnosis.' };
export const expressionResponseSchema = strictOptional({ ...object({
  reply: { type: 'string', maxLength: 8000, description: 'Ordinary reply to the user, in the normal conversation language.' },
  decision: { description: 'Choose from the actual context. Retaining a useful form is valid; no geometry quota or semantic presets. A required decision does not require an effect.', anyOf: [
    object({ mode: { const: 'retain' }, reasonCode, payload: { type: 'null' } }),
    object({ mode: { const: 'compose' }, reasonCode, payload: { type: 'object', properties: geometry, required: ['parts'], additionalProperties: false } }),
    object({ mode: { const: 'animate' }, reasonCode, payload: configuration }),
  ] },
}), $defs: { ...compositionSchema.$defs, ...live.$defs } });
const ajv = new Ajv({ strict: false, strictNumbers: true }), validate = ajv.compile(expressionResponseSchema);
const validateConfiguration = ajv.compile({ ...configuration, $defs: live.$defs });
export function parseExpressionResponse(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw Error('response_size');
  let parsed; try { parsed = JSON.parse(text); } catch { throw Error('response_json'); }
  if (!validate(parsed)) throw Error('response_schema');
  const decision = parsed.decision;
  if (decision.mode === 'retain') return { reply: parsed.reply, mode: 'retain', reasonCode: decision.reasonCode };
  const payload = withoutNulls(decision.payload);
  if (payload.style && !Object.keys(payload.style).length) delete payload.style;
  if (decision.mode === 'compose') { composeExpression(payload); return { reply: parsed.reply, mode: 'compose', reasonCode: decision.reasonCode, tool: 'compose_expression', args: payload }; }
  if (!validateConfiguration(payload)) throw Error('response_configuration');
  return { reply: parsed.reply, mode: 'animate', reasonCode: decision.reasonCode, tool: 'express', args: {
    body: { type: 'live', program: null, configuration: payload }, policy: 'replace' } };
}
const mutations = new Set(['express', 'compose_expression', 'return_to_face', 'cancel_expression', 'playground_edit']);
export const isBodyMutation = item => item?.server === 'fisch_live' && mutations.has(item.tool);
export class ExpressionResponseChannel {
  states = new WeakMap(); generation = 0;
  constructor({ call, now = () => performance.now(), id = randomUUID }) { Object.assign(this, { call, now, id }); }
  begin({ threadId, epoch, timeoutMs = 120000 }) {
    if (typeof threadId !== 'string' || !threadId || typeof epoch !== 'string' || !epoch || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw Error('response_lease');
    const at = this.now(); if (!Number.isFinite(at)) throw Error('response_clock');
    this.revoke();
    const token = Object.freeze({ threadId, epoch, generation: this.generation, startedAt: at, deadline: at + timeoutMs, requestId: this.id() });
    this.active = token; this.states.set(token, { used: false, turnId: null }); return token;
  }
  revoke() { this.generation++; this.active = null; }
  current(token) { const at = this.now(); return !!token && this.active === token && token.generation === this.generation && Number.isFinite(at) && at >= token.startedAt && at < token.deadline; }
  bind(token, turnId) {
    const state = this.states.get(token);
    if (!state || !this.current(token) || typeof turnId !== 'string' || !turnId || state.turnId) return false;
    state.turnId = turnId; return true;
  }
  async complete(token, turn) {
    const state = this.states.get(token);
    if (!state || state.used || !this.current(token)) return { dispatch: 'dropped', reason: 'revoked_expired_or_duplicate' };
    state.used = true;
    if (!state.turnId || turn?.turnId !== state.turnId || turn.threadId !== token.threadId || turn.status !== 'completed') return { dispatch: 'dropped', reason: 'foreign_or_incomplete_turn' };
    if (!Array.isArray(turn.toolRequests) || turn.truncated !== false || turn.toolRequests.some(item => !validTool(item))) return { dispatch: 'dropped', reason: 'trace_incomplete' };
    let response;
    try { response = uniqueResponse(turn.messages); } catch (error) { return { dispatch: 'dropped', reason: error.message }; }
    const toolMutation = (turn.toolRequests ?? []).some(isBodyMutation);
    const result = { reply: response.reply, mode: response.mode, reasonCode: response.reasonCode, toolMutation };
    if (turn.truncated) return { ...result, dispatch: 'dropped', reason: 'trace_incomplete' };
    if (response.mode === 'retain') return { ...result, dispatch: 'retained' };
    if (toolMutation) return { ...result, dispatch: 'suppressed', reason: 'existing_tool_mutation' };
    if (!this.current(token)) return { ...result, dispatch: 'dropped', reason: 'revoked_before_dispatch' };
    const args = { ...response.args, requestId: token.requestId, expectedEpoch: token.epoch };
    let receipt;
    try {
      const value = await this.call('mcpServer/tool/call', { threadId: token.threadId, server: 'fisch_live', tool: response.tool, arguments: args });
      receipt = JSON.parse(value.content?.find(item => item.type === 'text')?.text ?? 'null');
      if (value.isError) {
        const known = /^(composition_[a-z_]+|expected_epoch_mismatch|invalid_arguments|request_id_reused)$/.test(receipt?.code ?? '');
        return { ...result, dispatch: known ? 'rejected' : 'unknown', reason: 'tool_error', receipt };
      }
    } catch { return { ...result, dispatch: 'unknown', reason: 'dispatch_outcome_unknown' }; }
    if (!this.current(token)) return { ...result, dispatch: 'unknown', reason: 'revoked_after_dispatch', receipt };
    if (!receipt || !['accepted', 'pending', 'rejected'].includes(receipt.status) || receipt.epoch !== token.epoch ||
      (receipt.status !== 'rejected' && (receipt.requestId !== token.requestId || typeof receipt.session !== 'string' || !receipt.session || !Number.isSafeInteger(receipt.seq) || receipt.seq < 1))) return { ...result, dispatch: 'unknown', reason: 'receipt_unverified', receipt };
    return { ...result, dispatch: receipt.status, receipt, visibility: 'unknown' };
  }
}
function validTool(item) { return typeof item?.id === 'string' && !!item.id && typeof item.server === 'string' && !!item.server && typeof item.tool === 'string' && !!item.tool; }
function uniqueResponse(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.some(m => typeof m?.id !== 'string' || !m.id)) throw Error('response_missing');
  if (new Set(messages.map(m => m.id)).size !== messages.length) throw Error('response_ambiguous');
  const last = parseExpressionResponse(messages.at(-1).text);
  for (const message of messages.slice(0, -1)) {
    let valid = false; try { parseExpressionResponse(message.text); valid = true; } catch {}
    if (valid) throw Error('response_ambiguous');
  }
  return last;
}
export async function runChannelTurn(client, threadId, text, options = {}) {
  const startedAt = performance.now(), capture = turnCapture(threadId, startedAt), receive = message => capture.receive(message);
  let timer, timedOut = false;
  const disconnected = () => capture.reject(Error('app_server_closed'));
  client.events.on('notification', receive); client.events.once('closed', disconnected);
  timer = setTimeout(() => { timedOut = true; if (capture.turnId) void client.call('turn/interrupt', { threadId, turnId: capture.turnId }).catch(() => {}); capture.reject(Error('model_turn_timeout')); }, options.timeoutMs ?? 90000);
  try {
    await options.beforeStart?.();
    if (timedOut) throw Error('model_turn_timeout');
    const ack = await client.call('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }], ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}) });
    if (!ack?.turn?.id) throw Error('turn_ack_missing');
    if (timedOut) { void client.call('turn/interrupt', { threadId, turnId: ack.turn.id }).catch(() => {}); throw Error('model_turn_timeout'); }
    if (options.onStarted?.(ack.turn.id) === false) { void client.call('turn/interrupt', { threadId, turnId: ack.turn.id }).catch(() => {}); throw Error('response_lease_revoked'); }
    capture.bind(ack.turn.id);
    return await capture.done;
  } finally { clearTimeout(timer); client.events.removeListener('notification', receive); client.events.removeListener('closed', disconnected); }
}
function turnCapture(threadId, startedAt) {
  let resolve, reject, owned, terminal = false, truncated = false, firstTool = null, firstExpression = null;
  const early = [], messages = [], tools = new Map();
  const done = new Promise((yes, no) => { resolve = yes; reject = no; }); void done.catch(() => {});
  function process(message, at) {
    if (terminal) return;
    const p = message.params, turnId = p.turnId ?? p.turn?.id; if (turnId !== owned) return;
    if (['item/started', 'item/completed'].includes(message.method) && p.item?.type === 'mcpToolCall') {
      if (!validTool(p.item)) truncated = true;
      firstTool ??= at - startedAt; if (isBodyMutation(p.item)) firstExpression ??= at - startedAt;
      if (tools.size >= 64 && !tools.has(p.item.id)) truncated = true; else tools.set(p.item.id, p.item);
    }
    if (message.method === 'item/completed' && p.item?.type === 'agentMessage') {
      if (typeof p.item.text !== 'string' || p.item.text.length > 65536 || messages.length >= 8) truncated = true;
      else if (messages.some(m => m.id === p.item.id && m.text !== p.item.text)) truncated = true;
      else if (!messages.some(m => m.id === p.item.id)) messages.push({ id: p.item.id, text: p.item.text, phase: p.item.phase ?? null });
    }
    if (message.method === 'turn/completed') {
      if (!p.turn || typeof p.turn.status !== 'string') { terminal = true; reject(Error('turn_terminal_invalid')); return; }
      terminal = true; resolve({ threadId, turnId: owned, status: p.turn.status, messages, toolRequests: [...tools.values()], truncated,
      timing: { firstToolMs: firstTool, firstExpressionMs: firstExpression, terminalMs: at - startedAt } }); }
  }
  return { done, reject, get turnId() { return owned; }, bind(id) { owned = id; for (const [m, at] of early) process(m, at); early.length = 0; },
    receive(message) { if (message.params?.threadId !== threadId) return; const at = performance.now();
      if (!owned) { if (early.length < 128) early.push([message, at]); else truncated = true; } else process(message, at); } };
}
