import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const protocol = read('../src/contracts/protocol.schema.json'), face = read('../src/core/live/face.json');
const limits = read('../src/contracts/capabilities.json');
const node = type => protocol.$defs.node.oneOf.map(item => item.$ref ? protocol.$defs[item.$ref.split('/').at(-1)] : item).find(item => item.properties?.type?.const === type);
const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source.properties[key]]));
const part = structuredClone(protocol.$defs.assemblyPart), motion = part.anyOf[0].properties.motion;
for (const kind of part.anyOf) kind.properties.motion = { $ref: '#/$defs/motion' };
export const compositionContract = Object.freeze({ schemaVersion: 1, defaultBase: 'none',
  baseFingerprint: createHash('sha256').update(JSON.stringify(face.parts)).digest('hex') });
export const compositionSchema = {
  type: 'object', additionalProperties: false, required: ['parts'], $defs: { part, motion },
  properties: {
    parts: { type: 'array', minItems: 1, maxItems: limits.assembly.parts, items: { $ref: '#/$defs/part' }, description: 'Your complete authored parts, or additions to an explicitly selected resting_face base. curve/ellipsoid/patch; stable unique IDs; bounded per-part motion is optional.' },
    base: { enum: ['none', 'resting_face'], default: 'none', description: `none replaces the whole body. resting_face explicitly includes ${face.parts.length} canonical parts counting toward the ${limits.assembly.parts}-part total, plus your parts with noncolliding IDs. Never means the current scene.` },
    durationMs: { ...node('assemble').properties.durationMs, default: 600 },
    easing: node('assemble').properties.easing,
    style: { type: 'object', additionalProperties: false, minProperties: 1, properties: pick(node('style'), ['color', 'brightness', 'pointSize', 'dispersion']) },
    flow: { type: 'object', additionalProperties: false, required: ['field', 'strength'], properties: pick(node('flow'), ['field', 'strength']) },
    requestId: { type: 'string', minLength: 1, maxLength: 128 },
    expectedEpoch: { type: 'string', minLength: 1, maxLength: 128 },
  },
};
const ajv = new Ajv({ strict: false, strictNumbers: true });
const validateInput = ajv.compile(compositionSchema);
const partValidators = new Map(part.anyOf.map(schema => [schema.properties.kind.const,
  ajv.compile({ ...schema, $defs: compositionSchema.$defs })]));
function compositionInputError(input) {
  const error = Error('composition_arguments');
  const details = [];
  const values = Array.isArray(input?.parts) ? input.parts.slice(0, limits.assembly.parts) : [];
  for (const [index, value] of values.entries()) {
    const validate = partValidators.get(value?.kind);
    if (!validate || validate(value)) continue;
    for (const issue of validate.errors) {
      details.push({ path: `/parts/${index}${issue.instancePath}`.slice(0, 160), rule: issue.keyword,
        ...(Number.isFinite(issue.params.limit) ? { limit: issue.params.limit } : {}) });
      if (details.length === 3) break;
    }
    if (details.length === 3) break;
  }
  if (details.length) error.details = details;
  return error;
}
const validateProgram = ajv.compile({ $defs: protocol.$defs, $ref: '#/$defs/node' });
export const compositionTool = { name: 'compose_expression',
  description: `Author a new particle silhouette or spatial composition from your own geometry (v1, base ${compositionContract.baseFingerprint.slice(0, 12)}). Omitted base means standalone. Explicit resting_face adds your parts to that optional avatar without copying it. Freely choose RGB and bounded part motion. No semantic presets. Use express for existing-part gestures or advanced choreography; retaining the current form/no new call can be appropriate. Same admission/status/cancel contract as express; ACK is not completion or recognition.`,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, inputSchema: compositionSchema };
export function composeExpression(input) {
  if (!validateInput(input)) throw compositionInputError(input);
  const args = structuredClone(input), parts = [...(args.base === 'resting_face' ? structuredClone(face.parts) : []), ...args.parts];
  if (parts.length > limits.assembly.parts) throw Error('composition_part_limit');
  if (new Set(parts.map(part => part.id)).size !== parts.length) throw Error('composition_part_collision');
  const durationMs = args.durationMs ?? 600, easing = args.easing ?? 'smoothstep';
  const children = [{ type: 'assemble', parts, durationMs, easing }];
  if (args.style) children.push({ type: 'style', ...args.style, durationMs, easing });
  if (args.flow) children.push({ type: 'flow', ...args.flow, durationMs, easing });
  const body = { type: 'parallel', children };
  if (!validateProgram(body)) throw Error('composition_program');
  const result = { body, policy: 'replace', ...(args.requestId ? { requestId: args.requestId } : {}), ...(args.expectedEpoch ? { expectedEpoch: args.expectedEpoch } : {}) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > limits.limits.recordBytes - 512) throw Error('composition_bytes');
  return result;
}
