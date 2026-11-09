import { matchesHandReadSet } from './decision-types';
import type { ReactiveRequest, ReactiveState, SemanticPrerequisite, SemanticSnapshot } from './decision-types';
const axes = ['orientation', 'expression', 'handMotion', 'handIdentity'] as const;
const prerequisites = ['orientation', 'expression', 'hand_motion'] as const;
const counter = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
function object(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('decision_contract');
  const fields = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(fields);
  if (names.length !== keys.length || names.some(key => !keys.includes(String(key)) || !Object.hasOwn(fields[key as string], 'value'))) throw Error('decision_contract');
  return Object.fromEntries(keys.map(key => [key, fields[key].value]));
}
export function freezeSemanticSnapshot(value: unknown): SemanticSnapshot {
  const snapshot = object(value, axes);
  if (!counter(snapshot.handIdentity) || axes.slice(0, 3).some(axis => snapshot[axis] !== null && !counter(snapshot[axis]))) throw Error('semantic_snapshot');
  return Object.freeze(snapshot) as SemanticSnapshot;
}
function array(value: unknown, min: number, max: number): any[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) throw Error('decision_array');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== value.length + 1) throw Error('decision_array');
  for (let i = 0; i < value.length; i++) if (!fields[i] || !Object.hasOwn(fields[i], 'value')) throw Error('decision_array');
  return Array.from({ length: value.length }, (_, i) => fields[i].value);
}
export function freezePrerequisites(value: unknown): readonly SemanticPrerequisite[] {
  const selected = array(value, 0, 3);
  if (new Set(selected).size !== selected.length || !selected.every(axis => prerequisites.includes(axis))) throw Error('prerequisites');
  return Object.freeze(selected);
}
export function matchesCriticalState(request: ReactiveRequest, state: ReactiveState): boolean {
  if (state.sessionId !== request.sessionId || state.epoch !== request.epoch || state.intentRevision !== request.intentRevision ||
    request.presenceRevision !== undefined && state.presenceRevision !== request.presenceRevision ||
    !request.requiredTrackIds.every(track => state.trackIds.includes(track))) return false;
  if (request.schemaVersion === 1) return matchesHandReadSet(request.handReadSet, state.handState);
  const hand = request.handReadSet, current = state.handState;
  return state.sourceHealthy === true && !!state.semanticSnapshot && request.semanticSnapshot.handIdentity === state.semanticSnapshot.handIdentity &&
    (!hand || !!current && hand.sourceGeneration === current.sourceGeneration && hand.primaryTrackId === current.primaryTrackId);
}
const axisKey = { orientation: 'orientation', expression: 'expression', hand_motion: 'handMotion' } as const;
export function knownPrerequisites(request: ReactiveRequest, selected: readonly SemanticPrerequisite[]): boolean {
  return request.schemaVersion === 1 || selected.every(axis => request.semanticSnapshot[axisKey[axis]] !== null);
}
export function matchesPrerequisites(request: ReactiveRequest, state: ReactiveState, selected: readonly SemanticPrerequisite[]): boolean {
  if (request.schemaVersion === 1) return true;
  return knownPrerequisites(request, selected) && !!state.semanticSnapshot && selected.every(axis =>
    request.semanticSnapshot[axisKey[axis]] === state.semanticSnapshot![axisKey[axis]]) &&
    (!selected.includes('hand_motion') || matchesHandReadSet(request.handReadSet, state.handState));
}
export function validateBriefV2Body(value: unknown) {
  const sequence = object(value, ['type', 'children']);
  if (sequence.type !== 'sequence') throw Error('v2_body');
  const parallel = object(array(sequence.children, 1, 1)[0], ['type', 'children']);
  if (parallel.type !== 'parallel') throw Error('v2_body');
  for (const value of array(parallel.children, 1, 3)) {
    const type = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'type')?.value : undefined, keys = type === 'morph' ? ['type', 'target', 'durationMs'] : type === 'flow' ? ['type', 'field', 'strength', 'durationMs'] :
      type === 'shapeQuality' ? ['type', 'rise', 'grow', 'effort', 'durationMs'] : [];
    const node = object(value, keys);
    if (!keys.length || !Number.isSafeInteger(node.durationMs) || node.durationMs < 200 || node.durationMs > 1000) throw Error('v2_body');
    if (type === 'flow' && !(typeof node.strength === 'number' && Number.isFinite(node.strength) && node.strength >= 0 && node.strength <= 1)) throw Error('v2_body');
    if (type === 'shapeQuality') {
      const effort = object(node.effort, ['time', 'weight', 'flow']);
      if (!(typeof node.rise === 'number' && typeof node.grow === 'number' && Number.isFinite(node.rise) && Number.isFinite(node.grow) && node.rise >= -0.4 && node.rise <= 0.4 && node.grow >= 0.7 && node.grow <= 1.3) ||
        Object.values(effort).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) throw Error('v2_body');
    }
  }
}
