import Ajv from 'ajv';
import { compositionSchema } from './compose-expression.mjs';
import { parsePresentationRecord } from './presentation-records.mjs';

const source = structuredClone(compositionSchema);
const curve = source.$defs.part.anyOf.find(part => part.properties.kind.const === 'curve').properties;
const ellipsoid = source.$defs.part.anyOf.find(part => part.properties.kind.const === 'ellipsoid').properties;
const num = source.$defs.position.items;
const id = source.$defs.id;
const color = source.$defs.color;
const scale = ellipsoid.scale.items;
const radius = curve.radius;
const tuple = (items, minItems = items.length) => ({ type: 'array', items, additionalItems: false, minItems, maxItems: items.length });
const xyz = tuple([num, num, num]);
const unit = { type: 'number', minimum: 0, maximum: 1 };
const xy = tuple([unit, unit]);
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
export const compactPresentationSchema = object({
  base: { enum: ['keep', 'replace', 'retain'] },
  parts: { type: 'array', minItems: 1, maxItems: source.properties.parts.maxItems, items: { oneOf: [
    tuple([{ const: 'e' }, id, num, num, num, scale, scale, scale, color], 8),
    tuple([{ const: 'c' }, id, { type: 'array', minItems: curve.points.minItems, maxItems: curve.points.maxItems, items: xyz }, radius, color], 4),
  ] } },
  durationMs: source.properties.durationMs,
  annotations: object({
    labels: { type: 'array', maxItems: 8, items: object({ text: { type: 'string', minLength: 1, maxLength: 48, pattern: '^[^\\u0000-\\u001f\\u007f]+$' }, x: unit, y: unit }) },
    arrows: { type: 'array', maxItems: 8, items: object({ from: xy, to: xy }) },
  }, []),
}, ['base']);
const validate = new Ajv({ strict: false, strictNumbers: true }).compile(compactPresentationSchema);

function expandPart(part) {
  const [kind, id] = part;
  if (kind === 'e') {
    const [, , x, y, z, sx, sy, sz, color] = part;
    return { id, kind: 'ellipsoid', center: [x, y, z], scale: [sx, sy, sz], ...(color ? { color } : {}) };
  }
  const [, , points, radius, color] = part;
  return { id, kind: 'curve', points, radius, ...(color ? { color } : {}) };
}

export function parseCompactPresentationRecord(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw Error('compact_record_size');
  const value = JSON.parse(text);
  if (!validate(value)) throw Error('compact_record_schema');
  if (value.base === 'retain') {
    if (Object.keys(value).length !== 1) throw Error('compact_retain_fields');
    return { mode: 'retain', payload: null };
  }
  if (!value.parts?.length) throw Error('compact_parts_required');
  if (new Set(value.parts.map(part => part[1])).size !== value.parts.length) throw Error('compact_duplicate_id');
  const payload = { base: value.base === 'keep' ? 'current_scene' : 'none', parts: value.parts.map(expandPart),
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }) };
  const decision = parsePresentationRecord(JSON.stringify({ mode: 'compose', payload }));
  const annotations = value.annotations;
  const labels = annotations?.labels ?? [];
  if (labels.reduce((n, label) => n + [...label.text].length, 0) > 256
    || labels.some(label => /[\u202a-\u202e\u2066-\u2069]/u.test(label.text))) throw Error('compact_label_text');
  if (annotations?.arrows?.some(arrow => arrow.from[0] === arrow.to[0] && arrow.from[1] === arrow.to[1])) throw Error('compact_arrow_degenerate');
  return { ...decision, ...(annotations ? { annotations: { labels: annotations.labels ?? [], arrows: annotations.arrows ?? [] } } : {}) };
}




