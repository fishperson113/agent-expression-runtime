import Ajv from 'ajv';
import { compositionSchema, composeExpression } from './compose-expression.mjs';

const geometry = structuredClone(compositionSchema);
for (const key of ['requestId', 'expectedEpoch', 'expectedSceneRevision', 'observerHandoffMs', 'observerContext', 'transient']) delete geometry.properties[key];
const defs = geometry.$defs; delete geometry.$defs;
export const presentationRecordSchema = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['mode', 'payload'],
      properties: { mode: { const: 'retain' }, payload: { type: 'null' } } },
    { type: 'object', additionalProperties: false, required: ['mode', 'payload'],
      properties: { mode: { const: 'compose' }, payload: geometry } },
  ], $defs: defs,
};
const validate = new Ajv({ strict: false, strictNumbers: true }).compile(presentationRecordSchema);

export function parsePresentationRecord(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw Error('presentation_record_size');
  const value = JSON.parse(text);
  if (!validate(value)) throw Error('presentation_record_schema');
  if (value.mode === 'compose') {
    const args = { ...value.payload };
    if (args.removePartIds) Object.assign(args, { expectedEpoch: 'validation-only', expectedSceneRevision: 1 });
    composeExpression(args);
  }
  return value;
}

// One complete scene is the atomic author output. Source authority stays in the host.
export function createPresentationRecordStream({ isCurrent, maxBytes = 65536, maxDepth = 48, parseRecord = parsePresentationRecord, onRejectedRecord } = {}) {
  if (typeof isCurrent !== 'function' || typeof parseRecord !== 'function' || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536
    || !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 64) throw Error('presentation_record_options');
  const state = { bytes: 0, text: '', depth: 0, string: false, escape: false, started: false, emitted: false, failed: false, ended: false };
  const fail = code => { state.failed = true; state.text = ''; throw Error(code); };
  const current = () => {
    let valid = false;
    try { valid = isCurrent() === true; } catch {}
    if (!valid) fail('presentation_record_stale');
  };
  const push = delta => {
    if (state.failed || state.ended) fail('presentation_record_closed');
    current();
    if (typeof delta !== 'string') fail('presentation_record_delta');
    state.bytes += Buffer.byteLength(delta);
    if (state.bytes > maxBytes) fail('presentation_record_size');
    const ready = [];
    for (const char of delta) {
      const complete = consume(state, char, maxDepth, fail);
      if (complete) {
        let value;
        try { value = parseRecord(state.text); } catch (error) {
          const cause = typeof error?.message === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(error.message) ? error.message : 'unclassified';
          try { onRejectedRecord?.({ code: 'presentation_record_invalid', cause }); } catch {}
          fail('presentation_record_invalid');
        }
        current(); state.emitted = true; state.text = ''; ready.push(value);
      }
    }
    return ready;
  };
  const finish = () => {
    if (state.failed || state.ended) fail('presentation_record_closed');
    current();
    if (!state.emitted) fail('presentation_record_incomplete');
    state.ended = true; return [];
  };
  return Object.freeze({ push, finish, cancel() { state.failed = true; state.text = ''; } });
}

function consume(state, char, maxDepth, fail) {
  if (state.emitted) {
    if (!/\s/u.test(char)) fail('presentation_record_extra');
    return false;
  }
  if (!state.started) {
    if (/\s/u.test(char)) return false;
    if (char !== '{') fail('presentation_record_framing');
    state.started = true;
  }
  state.text += char;
  if (state.string) {
    if (state.escape) state.escape = false;
    else if (char === '\\') state.escape = true;
    else if (char === '"') state.string = false;
  } else if (char === '"') state.string = true;
  else if (char === '{' || char === '[') {
    if (++state.depth > maxDepth) fail('presentation_record_depth');
  } else if (char === '}' || char === ']') {
    state.depth--;
    if (state.depth < 0) fail('presentation_record_framing');
    if (state.depth === 0) return true;
  }
  return false;
}


