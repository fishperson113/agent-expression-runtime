import { composeExpression } from './compose-expression.mjs';

// Pure visual compilation; source admission and native text stay with the caller.
export function presentationBody(decision, scope) {
  if (decision.mode === 'retain') return null;
  if (decision.mode === 'compose') return composeExpression({ ...decision.payload,
    expectedEpoch: scope.epoch, ...(decision.payload.base === 'current_scene' && decision.payload.removePartIds !== undefined ? { expectedSceneRevision: scope.sceneRevision } : {}) }).body;
  if (decision.mode === 'animate') return { type: 'live', program: null, configuration: decision.payload };
  throw Error('presentation_decision');
}
