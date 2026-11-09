import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const id = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const handReadSet = object({ stateRevision: integer, sourceGeneration: integer, primaryTrackId: { anyOf: [id, { type: 'null' }] } });
const requestSchema = object({ schemaVersion: { const: 1 }, sessionId: id, epoch: id, requestId: id,
  intentRevision: integer, presenceRevision: integer, deadline: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  requiredTrackIds: { type: 'array', maxItems: 16, uniqueItems: true, items: id }, handReadSet });
requestSchema.required = requestSchema.required.filter(key => key !== 'handReadSet');
const observationSchema = JSON.parse(readFileSync(new URL('../src/contracts/live.schema.json', import.meta.url), 'utf8'));
const eventSchema = object({ id: integer, type: { enum: ['user_arrived', 'user_left', 'looked_away', 'looked_back',
  'expression_changed', 'mouth_started', 'mouth_stopped', 'turn_changed'] }, at: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } });
const ajv = new Ajv({ strict: false, allErrors: false });
ajv.addSchema(observationSchema, 'urn:fisch:observation:v1');
const validateRequest = ajv.compile(requestSchema);
const validate = ajv.compile(object({ schemaVersion: { const: 1 }, request: requestSchema,
  events: { type: 'array', minItems: 1, maxItems: 8, items: eventSchema },
  observations: { type: 'array', minItems: 1, maxItems: 4, items: { $ref: 'urn:fisch:observation:v1' } } }));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const explicitHandReadSet = request => !Object.hasOwn(request, 'handReadSet') || request.handReadSet !== undefined;
export function freezeReactiveWindow(value) {
  if (!validate(value) || !explicitHandReadSet(value.request)) throw Error('reactive_window_invalid');
  const observations = value.observations.map(({ summary: _summary, ...observation }) => observation);
  if (observations.some(item => item.sessionId !== value.request.sessionId)) throw Error('reactive_window_session');
  const safe = { schemaVersion: 1, request: value.request, events: value.events, observations };
  const serialized = JSON.stringify(safe);
  if (Buffer.byteLength(serialized) > 65536) throw Error('reactive_window_size');
  return freeze(JSON.parse(serialized));
}

export function freezeReactiveCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !Object.hasOwn(value, 'request') || !Object.hasOwn(value, 'observationWindow') ||
      !validateRequest(value.request) || !validate(value.observationWindow) ||
      !explicitHandReadSet(value.request) || !explicitHandReadSet(value.observationWindow.request)) throw Error('reactive_candidate_invalid');
  const outer = value.request, inner = value.observationWindow.request;
  for (const key of Object.keys(requestSchema.properties)) {
    const matches = key === 'handReadSet' ? (outer[key] === undefined && inner[key] === undefined ||
      !!outer[key] && !!inner[key] && ['stateRevision', 'sourceGeneration', 'primaryTrackId'].every(field => outer[key][field] === inner[key][field])) : key === 'requiredTrackIds' ? outer[key].length === inner[key].length && outer[key].every(id => inner[key].includes(id)) : outer[key] === inner[key];
    if (!matches) throw Error('reactive_candidate_mismatch');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > 65536) throw Error('reactive_candidate_size');
  return freeze(JSON.parse(serialized));
}
