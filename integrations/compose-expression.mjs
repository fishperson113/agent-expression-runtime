import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const protocol = read('../src/contracts/protocol.schema.json'), face = read('../src/core/live/face.json');
const limits = read('../src/contracts/capabilities.json');
const contextSchema = read('../src/contracts/live-control.schema.json').$defs.observerContext;
const node = type => protocol.$defs.node.oneOf.map(item => item.$ref ? protocol.$defs[item.$ref.split('/').at(-1)] : item).find(item => item.properties?.type?.const === type);
const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source.properties[key]]));
const part = structuredClone(protocol.$defs.assemblyPart), motion = part.anyOf[0].properties.motion;
for (const kind of part.anyOf) kind.properties.motion = { $ref: '#/$defs/motion' };
export const compositionContract = Object.freeze({ schemaVersion: 1, defaultBase: 'none',
  baseFingerprint: createHash('sha256').update(JSON.stringify(face.parts)).digest('hex') });
export const compositionSchema = {
  type: 'object', additionalProperties: false, required: ['parts'], $defs: { part, motion },
  properties: {
    parts: { type: 'array', minItems: 1, maxItems: limits.assembly.parts, items: { $ref: '#/$defs/part' }, description: [
      'Complete curve/ellipsoid/patch parts; stable IDs; optional bounded motion.',
      'weight (default 1) shares a fixed particle budget proportionally, rounded; not scale/mass/emotion.',
      'World xyz, not pixels: perspective from +Y/+Z toward origin, uniform scene fitting; depth gaps can project to overlap.',
      'Use separation/hierarchy when useful; intentional overlap/no fixed style allowed.',
    ].join(' ') },
    base: { enum: ['none', 'resting_face'], default: 'none', description: `none replaces the whole body. resting_face explicitly includes ${face.parts.length} canonical parts counting toward the ${limits.assembly.parts}-part total, plus your parts with noncolliding IDs. Never means the current scene.` },
    durationMs: { ...node('assemble').properties.durationMs, default: 600 },
    easing: node('assemble').properties.easing,
    observerContext: { ...contextSchema, description: 'MAIN-authored public interaction brief displayed to the user. Not automatic task/transcript sharing or camera evidence. quiet pauses observer inference for a finite window; does not grant geometry permission.' },
    observerHandoffMs: { type: 'integer', minimum: 1000, maximum: 60000, description: 'MAIN only: explicitly disposable body, one-shot observer replacement after this program lease; bounded window, no overlay/restoration. Omit to protect your scene.' },
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
const diagnosticPaths = new Set(['', ...Object.keys(compositionSchema.properties).map(key => `/${key}`),
  ...['style', 'flow'].flatMap(key => Object.keys(compositionSchema.properties[key].properties).map(field => `/${key}/${field}`))]);
function rootInputDetails(errors) {
  return (errors ?? []).filter(issue => diagnosticPaths.has(issue.instancePath)).slice(0, 3).map(issue => ({
    path: issue.instancePath, rule: issue.keyword,
    ...(Number.isFinite(issue.params.limit) ? { limit: issue.params.limit } : {}),
  }));
}
function compositionInputError(input) {
  const error = Error('composition_arguments');
  const details = [];
  const values = Array.isArray(input?.parts) ? input.parts.slice(0, limits.assembly.parts) : [];
  for (const [index, value] of values.entries()) {
    const validate = partValidators.get(value?.kind);
    if (!validate) {
      details.push({ path: `/parts/${index}${value && typeof value === 'object' ? '/kind' : ''}`,
        rule: value && typeof value === 'object' ? (Object.hasOwn(value, 'kind') ? 'enum' : 'required') : 'type' });
      if (details.length === 3) break;
      continue;
    }
    if (validate(value)) continue;
    for (const issue of validate.errors) {
      details.push({ path: `/parts/${index}${issue.instancePath}`.slice(0, 160), rule: issue.keyword,
        ...(Number.isFinite(issue.params.limit) ? { limit: issue.params.limit } : {}) });
      if (details.length === 3) break;
    }
    if (details.length === 3) break;
  }
  if (!details.length) details.push(...rootInputDetails(validateInput.errors));
  if (details.length) error.details = details;
  return error;
}
const validateProgram = ajv.compile({ $defs: protocol.$defs, $ref: '#/$defs/node' });
export const compositionTool = { name: 'compose_expression',
  description: `Author a new particle silhouette or spatial composition from your own geometry (v1, base ${compositionContract.baseFingerprint.slice(0, 12)}). Omitted base means standalone. Explicit resting_face adds your parts to that optional avatar without copying it. Freely choose RGB and bounded part motion. No semantic presets. Use express for existing-part gestures or advanced choreography; retaining the current form/no new call can be appropriate. Same admission/status/cancel contract as express; ACK is not completion or recognition.`,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, inputSchema: compositionSchema };
function expansionError(code, details) { return Object.assign(Error(code), { details }); }
function validateExpandedParts(base, authored) {
  const remaining = limits.assembly.parts - base.length;
  if (authored.length > remaining) throw expansionError('composition_part_limit', [{ path: '/parts', rule: 'maxItems', limit: remaining }]);
  const seen = new Set(base.map(value => value.id)), details = [];
  for (const [index, value] of authored.entries()) {
    if (seen.has(value.id)) details.push({ path: `/parts/${index}/id`, rule: 'unique' });
    seen.add(value.id);
    if (details.length === 3) break;
  }
  if (details.length) throw expansionError('composition_part_collision', details);
}
export function composeExpression(input) {
  if (!validateInput(input)) throw compositionInputError(input);
  const args = structuredClone(input), base = args.base === 'resting_face' ? structuredClone(face.parts) : [];
  validateExpandedParts(base, args.parts);
  const parts = [...base, ...args.parts];
  const durationMs = args.durationMs ?? 600, easing = args.easing ?? 'smoothstep';
  const children = [{ type: 'assemble', parts, durationMs, easing }];
  if (args.style) children.push({ type: 'style', ...args.style, durationMs, easing });
  if (args.flow) children.push({ type: 'flow', ...args.flow, durationMs, easing });
  const body = { type: 'parallel', children };
  if (!validateProgram(body)) throw Error('composition_program');
  const output = args.observerHandoffMs === undefined && args.observerContext === undefined ? body : { type: 'live', program: body, configuration: { controls: [], poses: [], lifetimeMs: Math.max(1000, durationMs), ...(args.observerHandoffMs === undefined ? {} : { observerHandoffMs: args.observerHandoffMs }), ...(args.observerContext === undefined ? {} : { observerContext: args.observerContext }) } };
  const result = { body: output, policy: 'replace', ...(args.requestId ? { requestId: args.requestId } : {}), ...(args.expectedEpoch ? { expectedEpoch: args.expectedEpoch } : {}) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > limits.limits.recordBytes - 512) throw Error('composition_bytes');
  return result;
}
