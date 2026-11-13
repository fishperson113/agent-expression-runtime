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
const weight = part.anyOf[0].properties.weight;
for (const kind of part.anyOf) {
  kind.properties.motion = { $ref: '#/$defs/motion' }; kind.properties.weight = { $ref: '#/$defs/weight' };
  kind.properties.trajectory = { $ref: '#/$defs/track' };
  kind.properties.trackRef = structuredClone(protocol.$defs.assemblyTrajectory.properties.group);
}
export const compositionContract = Object.freeze({ schemaVersion: 1, defaultBase: 'none',
  baseFingerprint: createHash('sha256').update(JSON.stringify(face.parts)).digest('hex') });
export const compositionSchema = {
  type: 'object', additionalProperties: false, required: ['parts'], $defs: { part, motion, weight, track: protocol.$defs.assemblyTrajectory },
  properties: {
    transient: { type: 'boolean' },
    tracks: { type: 'array', minItems: 1, maxItems: limits.assembly.parts, items: { $ref: '#/$defs/track' } },
    parts: { type: 'array', minItems: 0, maxItems: limits.assembly.parts, items: { $ref: '#/$defs/part' }, description: [
      'Stable IDs; xyz. Track groups match; atMs starts at 0 and increases; no motion. Weight default 1. Color inherits.',
    ].join(' ') },
    base: { enum: ['none', 'resting_face', 'current_scene'], default: 'none' },
    durationMs: { ...node('assemble').properties.durationMs, default: 600 },
    easing: node('assemble').properties.easing,
    observerContext: { ...contextSchema, description: 'MAIN brief, not geometry authority.' },
    observerHandoffMs: { type: 'integer', minimum: 1000, maximum: 60000, description: 'MAIN one-shot handoff after lease.' },
    style: { type: 'object', additionalProperties: false, minProperties: 1, properties: pick(node('style'), ['color', 'brightness', 'pointSize', 'dispersion']) },
    flow: { type: 'object', additionalProperties: false, required: ['field', 'strength'], properties: pick(node('flow'), ['field', 'strength']) },
    requestId: { type: 'string', minLength: 1, maxLength: 128 },
    removePartIds: { type: 'array', minItems: 1, maxItems: limits.assembly.parts, uniqueItems: true, items: structuredClone(protocol.$defs.assemblyTrajectory.properties.group) },
    expectedSceneRevision: { type: 'integer', minimum: 1 },
    expectedEpoch: { type: 'string', minLength: 1, maxLength: 128 },
  },
};
compositionSchema.properties.style.properties.pointSize = { ...compositionSchema.properties.style.properties.pointSize,
  description: 'Sprite pixels (2-4), not radius.' };
const vector = part.anyOf[0].properties.points.items;
compositionSchema.$defs.position = vector;
function sharePosition(value) {
  if (!value || typeof value !== 'object') return value;
  if (JSON.stringify(value) === JSON.stringify(vector)) return { $ref: '#/$defs/position' };
  return Array.isArray(value) ? value.map(sharePosition) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sharePosition(v)]));
}
for (const key of ['part', 'motion', 'track']) compositionSchema.$defs[key] = sharePosition(compositionSchema.$defs[key]);
const rotation = part.anyOf[1].properties.rotation;
compositionSchema.$defs.rotation = rotation;
compositionSchema.$defs.part.anyOf[1].properties.rotation = { ...structuredClone(rotation),
  items: { type: 'number', minimum: -4 * Math.PI, maximum: 4 * Math.PI } };
compositionSchema.$defs.track.properties.keyframes.items.properties.rotate = { $ref: '#/$defs/rotation' };
function shareDefinition(name, target) {
  const exact = JSON.stringify(target);
  const replace = value => {
    if (!value || typeof value !== 'object') return value;
    if (JSON.stringify(value) === exact) return { $ref: `#/$defs/${name}` };
    return Array.isArray(value) ? value.map(replace) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
  };
  for (const key of Object.keys(compositionSchema.$defs)) compositionSchema.$defs[key] = replace(compositionSchema.$defs[key]);
  compositionSchema.properties = replace(compositionSchema.properties);
  compositionSchema.$defs[name] = target;
}
shareDefinition('id', structuredClone(protocol.$defs.assemblyTrajectory.properties.group));
shareDefinition('color', structuredClone(part.anyOf[0].properties.color));
shareDefinition('unit', structuredClone(compositionSchema.properties.flow.properties.strength));
const ajv = new Ajv({ strict: false, strictNumbers: true });
const validateInput = ajv.compile(compositionSchema);
const partValidators = new Map(compositionSchema.$defs.part.anyOf.map(schema => [schema.properties.kind.const,
  ajv.compile({ ...schema, $defs: compositionSchema.$defs })]));
const diagnosticPaths = new Set(['', ...Object.keys(compositionSchema.properties).map(key => `/${key}`),
  ...['style', 'flow'].flatMap(key => Object.keys(compositionSchema.properties[key].properties).map(field => `/${key}/${field}`))]);
function rootInputDetails(errors) {
  return (errors ?? []).filter(issue => (diagnosticPaths.has(issue.instancePath) || issue.instancePath.startsWith('/tracks/'))).slice(0, 3).map(issue => ({
    path: issue.instancePath.slice(0, 160), rule: issue.keyword,
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
      const object = value && typeof value === 'object' && !Array.isArray(value);
      details.push({ path: `/parts/${index}${object ? '/kind' : ''}`,
        rule: object ? (Object.hasOwn(value, 'kind') ? 'enum' : 'required') : 'type' });
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
  description: `For an ordinary conversational prop/illustration, prefer current_scene to retain the current body unless whole-body transformation is intended. Author a particle silhouette or spatial composition from your own geometry (v1, base ${compositionContract.baseFingerprint.slice(0, 12)}). Omitted base means standalone replacement, not append. For selective removal/edit use current_scene, removePartIds with exact IDs, parts:[] for removal only or authored replacement parts, and fresh expectedEpoch+expectedSceneRevision from the host inventory. The host preserves all unselected geometry/motion and rejects stale revisions or unknown IDs; never reconstruct the retained scene. Re-adding a removed ID preserves its identity and bindings. Empty final scenes reject; for intentional whole-body transformation prefer base:none. For additive props prefer current_scene: send only new parts; the MAIN host retains its current authored body with stable IDs and motion/track data. The ${limits.assembly.parts}-part limit includes retained parts. Reuse the host scene inventory supplied with the current message for known IDs/capacity; inspect_expression only when needed facts are absent/stale (observe is not geometry). On scene_append_part_limit_remaining_N, simplify only NEW parts to fit N, never replace the retained body as a fallback. Busy/unavailable scenes or collisions reject without replacement. resting_face includes only the canonical avatar, not a custom moving body. Do not reconstruct unavailable geometry from summaries. Whole-body transformation remains valid when intentional. Clarify unresolved spatial references before choosing a side. Static ellipsoid rotation is radians within +/-4pi, normalized modulo2pi; motion and trajectory bounds are unchanged. Freely choose RGB and bounded motion. Ellipsoid scale is at least 0.02 on every axis, including thin depth; use curves or patches for thinner features. Share rigid tracks via tracks[{group,pivot,keyframes}] and part.trackRef=group; or inline trajectory. No motion with either. Track groups must be unique. current_scene must omit transient:true and observerHandoffMs: additions do not grant observer ownership of the retained body. For replacement conversational illustrations choose transient:true, even when asked for a new picture; omit/false when the user explicitly asks to keep or edit the scene. No semantic presets. Use express for existing-part gestures or advanced choreography; retaining the current form/no new call can be appropriate. Same admission/status/cancel contract as express; ACK is not completion or recognition. A returned lifecycle.status=completed is sufficient scheduler completion evidence, so do not redundantly call expression_status. Applied/pending/unknown are not completion; query status only when needed. visibility=unknown remains unknown, never proof of visual meaning.`,
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
function expandTracks(args) {
  const tracks = new Map();
  for (const [index, track] of (args.tracks ?? []).entries()) {
    if (tracks.has(track.group)) throw expansionError('composition_track_duplicate', [{ path: `/tracks/${index}/group`, rule: 'unique' }]);
    tracks.set(track.group, track);
  }
  return args.parts.map((part, index) => {
    const { trackRef, ...body } = part;
    if (trackRef === undefined) return body;
    if (body.trajectory || body.motion) throw expansionError('composition_track_conflict', [{ path: `/parts/${index}/trackRef`, rule: 'exclusive' }]);
    const track = tracks.get(trackRef);
    if (!track) throw expansionError('composition_track_missing', [{ path: `/parts/${index}/trackRef`, rule: 'reference' }]);
    return { ...body, trajectory: structuredClone(track) };
  });
}
function normalizeStaticRotations(args) {
  for (const part of args.parts) if (part.kind === 'ellipsoid' && part.rotation) {
    part.rotation = part.rotation.map(angle => angle >= rotation.items.minimum && angle <= rotation.items.maximum
      ? angle : angle - Math.round(angle / (2 * Math.PI)) * (2 * Math.PI));
  }
  return args;
}
export function composeExpression(input) {
  if (!validateInput(input)) throw compositionInputError(input);
  if (input.removePartIds !== undefined ? input.base !== 'current_scene' || !input.expectedEpoch || !Number.isSafeInteger(input.expectedSceneRevision)
    : !input.parts.length || input.expectedSceneRevision !== undefined) throw Error('composition_edit_fence');
  if (input.base === 'current_scene' && (input.transient === true || input.observerHandoffMs !== undefined)) throw Error('scene_append_ownership');
  const args = normalizeStaticRotations(structuredClone(input)), base = args.base === 'resting_face' ? structuredClone(face.parts) : [];
  validateExpandedParts(base, args.parts);
  const parts = [...base, ...expandTracks(args)];
  const durationMs = args.durationMs ?? 600, easing = args.easing ?? 'smoothstep';
  const children = parts.length ? [{ type: 'assemble', parts, durationMs, easing }] : [{ type: 'wait', durationMs }];
  if (args.style) children.push({ type: 'style', ...args.style, durationMs, easing });
  if (args.flow) children.push({ type: 'flow', ...args.flow, durationMs, easing });
  const body = { type: 'parallel', children };
  if (!validateProgram(body)) throw Error('composition_program');
  const output = args.observerHandoffMs === undefined && args.observerContext === undefined && args.transient !== true && args.base !== 'current_scene' ? body : { type: 'live', program: body, configuration: { controls: [], poses: [], ...(args.base === 'current_scene' ? { sceneAppend: true, ...(args.removePartIds ? { sceneRemove: args.removePartIds, sceneRevision: args.expectedSceneRevision, sceneEasing: easing } : {}) } : {}), ...(args.transient === true ? { transient: true } : {}), lifetimeMs: Math.max(1000, durationMs), ...(args.observerHandoffMs === undefined ? {} : { observerHandoffMs: args.observerHandoffMs }), ...(args.observerContext === undefined ? {} : { observerContext: args.observerContext }) } };
  const result = { body: output, policy: 'replace', ...(args.requestId ? { requestId: args.requestId } : {}), ...(args.expectedEpoch ? { expectedEpoch: args.expectedEpoch } : {}) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > limits.limits.recordBytes - 512) throw Error('composition_bytes');
  return result;
}



