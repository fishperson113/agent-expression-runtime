import { eventKinds, validateObservation } from './observation';
import { causalRevocationReasons, type CausalKind } from './causal-recorder-types';
const id = (value: unknown, max = 64) => typeof value === 'string' && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`).test(value);
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const integer = (value: unknown) => number(value) && Number.isSafeInteger(value);
const reasons = ['observed', 'accepted', 'busy', 'duplicate', 'capacity', 'invalid_request', 'invalid_decision', 'stale', 'revoked', 'transport_unknown', 'admission_failed'];
const phases = ['received', 'admitted', 'rejected', 'applied', 'completed', 'cancelled', 'frame_submitted', 'frame_changed_proxy'];
function requireValue(condition: unknown) { if (!condition) throw Error('invalid_payload'); }
export function object(value: unknown, required: string[], optional: string[] = []): Record<string, any> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  const result = value as Record<string, any>;
  requireValue(required.every(key => Object.hasOwn(result, key)) && Object.keys(result).every(key => [...required, ...optional].includes(key)));
  return result;
}
export function inspect(value: unknown, state = { nodes: 0, bytes: 0 }, depth = 0, ancestors = new Set<object>()) {
  if (++state.nodes > 8192 || depth > 12) throw Error('invalid_payload');
  if (typeof value === 'string') { state.bytes += value.length * 3; if (state.bytes > 32768) throw Error('record_too_large'); return; }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { requireValue(Number.isFinite(value)); return; }
  requireValue(value && typeof value === 'object'); const item = value as object;
  const prototype = Object.getPrototypeOf(item);
  requireValue(prototype === Object.prototype || prototype === null || Array.isArray(item) && prototype === Array.prototype);
  requireValue(!ancestors.has(item)); ancestors.add(item);
  const descriptors = Object.getOwnPropertyDescriptors(item);
  requireValue(!Object.getOwnPropertySymbols(item).length);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    requireValue(!['__proto__', 'constructor', 'prototype'].includes(key) && 'value' in descriptor);
    if (Array.isArray(item) && key === 'length') continue;
    requireValue(descriptor.enumerable);
    state.bytes += key.length * 3; if (state.bytes > 32768) throw Error('record_too_large');
    inspect(descriptor.value, state, depth + 1, ancestors);
  }
  if (Array.isArray(item)) requireValue(Object.keys(item).length === item.length && Object.keys(item).every((key, i) => key === String(i)));
  ancestors.delete(item);
}
function references(value: unknown, limit: number) {
  requireValue(Array.isArray(value) && value.length <= limit);
  for (const item of value as unknown[]) { const ref = object(item, ['sessionId', 'seq']); requireValue(id(ref.sessionId, 80) && integer(ref.seq)); }
}
function requestPayload(value: unknown) {
  const payload = object(value, ['request', 'observationRefs', 'eventRefs']);
  const request = object(payload.request, ['schemaVersion', 'sessionId', 'epoch', 'requestId', 'intentRevision', 'deadline', 'requiredTrackIds'], ['presenceRevision']);
  requireValue(request.schemaVersion === 1 && ['sessionId', 'epoch', 'requestId'].every(key => id(request[key])) && integer(request.intentRevision) && number(request.deadline));
  if ('presenceRevision' in request) requireValue(integer(request.presenceRevision));
  requireValue(Array.isArray(request.requiredTrackIds) && request.requiredTrackIds.length <= 16 && request.requiredTrackIds.every((value: unknown) => id(value)) && new Set(request.requiredTrackIds).size === request.requiredTrackIds.length);
  references(payload.observationRefs, 4); references(payload.eventRefs, 8); return payload;
}
function optionalFields(payload: Record<string, any>) {
  for (const key of ['requestId', 'decisionId', 'actionId']) if (key in payload) requireValue(id(payload[key]));
  for (const key of ['at', 'validUntil']) if (key in payload) requireValue(number(payload[key]));
  for (const key of ['seq', 'turn', 'frame', 'signature']) if (key in payload) requireValue(integer(payload[key]));
  if ('origin' in payload) requireValue(['native', 'reactive', 'ambient'].includes(payload.origin));
  if ('epoch' in payload) requireValue(id(payload.epoch, 80));
}
function metadata(kind: CausalKind, value: unknown) {
  let payload;
  if (kind === 'authorization') {
    payload = object(value, ['requestId', 'allowed', 'reason']);
    requireValue(typeof payload.allowed === 'boolean' && ['authorized', 'denied', 'revoked', 'stale', 'unavailable'].includes(payload.reason));
    requireValue(payload.allowed === (payload.reason === 'authorized'));
  } else if (kind === 'decision') {
    payload = object(value, ['requestId', 'reason'], ['decisionId', 'actionId', 'mode', 'validUntil']); requireValue(reasons.includes(payload.reason));
    if ('mode' in payload) requireValue(['observe', 'express'].includes(payload.mode));
  } else if (kind === 'revocation') {
    payload = object(value, ['reason'], ['requestId', 'decisionId', 'actionId']); requireValue((causalRevocationReasons as readonly string[]).includes(payload.reason));
  } else if (kind === 'execution') {
    payload = object(value, ['seq', 'epoch', 'phase', 'at'], ['origin', 'turn', 'frame', 'requestId', 'decisionId', 'actionId']); requireValue(phases.includes(payload.phase));
  } else if (kind === 'frame') payload = object(value, ['frame'], ['signature', 'origin', 'requestId', 'decisionId', 'actionId']);
  else throw Error('invalid_payload');
  optionalFields(payload); return payload;
}
export function project(kind: CausalKind, value: unknown): unknown {
  inspect(value);
  if (kind === 'observation') { const { summary: _summary, ...snapshot } = validateObservation(value); return snapshot; }
  if (kind === 'request') return structuredClone(requestPayload(value));
  if (kind === 'event') {
    const event = object(value, ['sessionId', 'observationSeq', 'seq', 'type', 'at']);
    requireValue(id(event.sessionId, 80) && integer(event.observationSeq) && integer(event.seq) && eventKinds.includes(event.type) && number(event.at));
    return structuredClone(event);
  }
  return structuredClone(metadata(kind, value));
}
