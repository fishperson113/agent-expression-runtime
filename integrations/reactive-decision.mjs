import Ajv from 'ajv';
import { planSchema } from './expression-plan.mjs';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const id = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' };
export const reactiveDecisionSchema = object({ schemaVersion: { const: 1 }, requestId: id, decisionId: id,
  mode: { enum: ['observe', 'express'] }, validUntil: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  action: { anyOf: [{ type: 'null' }, object({ actionId: id, body: structuredClone(planSchema.properties.body) })] } });
reactiveDecisionSchema.$defs = structuredClone(planSchema.$defs);
const briefNodes = planSchema.properties.body.properties.children.items.properties.children.items.anyOf
  .filter(node => ['morph', 'flow', 'shapeQuality', 'style'].includes(node.properties.type.const)).map(node => {
    const copy = structuredClone(node); copy.properties.durationMs = { type: 'integer', minimum: 200, maximum: 1000 }; return copy;
  });
export const reactiveDecisionSchemaV2 = object({ ...structuredClone(reactiveDecisionSchema.properties), schemaVersion: { const: 2 },
  prerequisites: { type: 'array', maxItems: 3, items: { enum: ['orientation', 'expression', 'hand_motion'] } },
  action: { anyOf: [{ type: 'null' }, object({ actionId: id, body: object({ type: { const: 'sequence' },
    children: { type: 'array', minItems: 1, maxItems: 1, items: object({ type: { const: 'parallel' },
      children: { type: 'array', minItems: 1, maxItems: 3, items: { anyOf: briefNodes } } }) } }) })] } });
export function reactiveSchema(version) {
  if (version === 1) return reactiveDecisionSchema;
  if (version === 2) return reactiveDecisionSchemaV2;
  throw Error('reactive_contract_invalid');
}
const ajv = new Ajv({ strict: false, allErrors: false });
const validators = new Map([[1, ajv.compile(reactiveDecisionSchema)], [2, ajv.compile(reactiveDecisionSchemaV2)]]);
function knownPrerequisites(decision, request) {
  const axes = { orientation: 'orientation', expression: 'expression', hand_motion: 'handMotion' };
  return decision.prerequisites.every(key => Number.isSafeInteger(request.semanticSnapshot?.[axes[key]]) && request.semanticSnapshot[axes[key]] >= 0);
}
function reasoning(item) {
  return item?.type === 'reasoning' && Object.keys(item).every(key => ['type', 'id', 'summary', 'status'].includes(key)) &&
    (item.id === undefined || typeof item.id === 'string') &&
    (item.status === undefined || ['completed', 'in_progress'].includes(item.status)) && Array.isArray(item.summary) &&
    item.summary.every(part => part?.type === 'summary_text' && typeof part.text === 'string' &&
      Object.keys(part).every(key => ['type', 'text'].includes(key)));
}
export function parseReactiveResponse(result, request, contractVersion = request.schemaVersion) {
  if (request.schemaVersion !== contractVersion || !validators.has(contractVersion)) throw Error('reactive_contract_mismatch');
  if (result?.status !== 'completed' || !Array.isArray(result.output) || result.output.length > 4) throw Error('reactive_response_status');
  const messages = result.output.filter(item => item?.type === 'message');
  if (messages.length !== 1 || result.output.some(item => item?.type !== 'message' && !reasoning(item))) throw Error('reactive_response_content');
  const message = messages[0];
  if (message.type !== 'message' || message.role !== 'assistant' || message.status !== 'completed' ||
      !Array.isArray(message.content) || message.content.length !== 1 || message.content[0]?.type !== 'output_text' ||
      typeof message.content[0].text !== 'string') throw Error('reactive_response_content');
  let decision;
  try { decision = JSON.parse(message.content[0].text); } catch { throw Error('reactive_response_json'); }
  if (!validators.get(contractVersion)(decision) || decision.schemaVersion !== contractVersion ||
      (contractVersion === 2 && (new Set(decision.prerequisites).size !== decision.prerequisites.length || !knownPrerequisites(decision, request))) || decision.requestId !== request.requestId || decision.validUntil > request.deadline ||
      (decision.mode === 'observe') !== (decision.action === null)) throw Error('reactive_decision_invalid');
  return decision;
}
