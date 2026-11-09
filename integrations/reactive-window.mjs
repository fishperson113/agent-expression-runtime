import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const id = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const requestSchema = object({ schemaVersion: { const: 1 }, sessionId: id, epoch: id, requestId: id,
  intentRevision: integer, deadline: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  requiredTrackIds: { type: 'array', maxItems: 16, uniqueItems: true, items: id } });
requestSchema.properties.presenceRevision = integer;
const observationSchema = JSON.parse(readFileSync(new URL('../src/contracts/live.schema.json', import.meta.url), 'utf8'));
const eventSchema = object({ id: integer, type: { enum: ['user_arrived', 'user_left', 'looked_away', 'looked_back',
  'expression_changed', 'mouth_started', 'mouth_stopped', 'turn_changed'] }, at: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } });
const ajv = new Ajv({ strict: false, allErrors: false });
ajv.addSchema(observationSchema, 'urn:fisch:observation:v1');
const validate = ajv.compile(object({ schemaVersion: { const: 1 }, request: requestSchema,
  events: { type: 'array', maxItems: 8, items: eventSchema },
  observations: { type: 'array', maxItems: 4, items: { $ref: 'urn:fisch:observation:v1' } } }));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function freezeReactiveWindow(value) {
  if (!validate(value)) throw Error('reactive_window_invalid');
  const observations = value.observations.map(({ summary: _summary, ...observation }) => observation);
  if (observations.some(item => item.sessionId !== value.request.sessionId)) throw Error('reactive_window_session');
  const safe = { schemaVersion: 1, request: value.request, events: value.events, observations };
  const serialized = JSON.stringify(safe);
  if (Buffer.byteLength(serialized) > 65536) throw Error('reactive_window_size');
  return freeze(JSON.parse(serialized));
}
