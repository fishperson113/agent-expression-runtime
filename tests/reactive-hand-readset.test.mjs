import { expect, it } from 'vitest';
import { freezeReactiveCandidate, freezeReactiveWindow } from '../integrations/reactive-window.mjs';
const window = () => ({ schemaVersion: 1, request: { schemaVersion: 1, sessionId: 's', epoch: 'e', requestId: 'r', intentRevision: 0,
  presenceRevision: 1, deadline: 1000, requiredTrackIds: [], handReadSet: { stateRevision: 3, sourceGeneration: 2, primaryTrackId: null } },
  events: [{ id: 1, type: 'user_arrived', at: 100 }], observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100, camera: 'absent', turn: 'idle', summary: 'local',
    user: { present: false, quality: { score: 0, basis: 'unavailable' }, position: null, head: null, expression: null, facingScreen: null, mouthMoving: null } }] });
it('accepts frozen absence or present-hand read sets and structurally binds outer request to the provider window', () => {
  for (const primaryTrackId of [null, 'hand_1_1']) {
    const value = window(); value.request.handReadSet.primaryTrackId = primaryTrackId;
    const frozen = freezeReactiveWindow(value); expect(Object.isFrozen(frozen.request.handReadSet)).toBe(true);
    expect(freezeReactiveCandidate({ request: structuredClone(value.request), observationWindow: value }).request.handReadSet).toEqual(value.request.handReadSet);
  }
});
it('rejects mismatched hand dependencies and every malformed optional read set before provider dispatch', () => {
  for (const patch of [{ stateRevision: 4 }, { sourceGeneration: 3 }, { primaryTrackId: 'hand_1_2' }]) {
    const value = window(), request = structuredClone(value.request); Object.assign(request.handReadSet, patch);
    expect(() => freezeReactiveCandidate({ request, observationWindow: value })).toThrow('reactive_candidate_mismatch');
  }
  for (const handReadSet of [undefined, null, {}, { stateRevision: -1, sourceGeneration: 2, primaryTrackId: null },
    { stateRevision: 3, sourceGeneration: NaN, primaryTrackId: null }, { stateRevision: 3, sourceGeneration: 2, primaryTrackId: 'private text' },
    { stateRevision: 3, sourceGeneration: 2, primaryTrackId: null, context: 'PRIVATE' }]) {
    const value = window(); value.request.handReadSet = handReadSet;
    expect(() => freezeReactiveWindow(value)).toThrow('reactive_window_invalid');
    expect(() => freezeReactiveCandidate({ request: value.request, observationWindow: value })).toThrow('reactive_candidate_invalid');
  }
});
it('keeps existing production face windows compatible when additive hand dependencies are omitted', () => {
  const value = window(); delete value.request.handReadSet;
  expect(freezeReactiveWindow(value).request.handReadSet).toBeUndefined();
  expect(freezeReactiveCandidate({ request: structuredClone(value.request), observationWindow: value }).request).toEqual(value.request);
  const outer = { ...value.request, handReadSet: { stateRevision: 3, sourceGeneration: 2, primaryTrackId: null } };
  expect(() => freezeReactiveCandidate({ request: outer, observationWindow: value })).toThrow('reactive_candidate_mismatch');
});
