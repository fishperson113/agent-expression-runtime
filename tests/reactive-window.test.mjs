import { expect, it } from 'vitest';
import { freezeReactiveWindow, freezeReactiveCandidate } from '../integrations/reactive-window.mjs';
const request = () => ({ schemaVersion: 1, sessionId: 'test', epoch: 'epoch', requestId: 'request', intentRevision: 0, presenceRevision: 1,
  deadline: 5000, requiredTrackIds: ['hand_1_1'], handReadSet: { stateRevision: 3, sourceGeneration: 1, primaryTrackId: 'hand_1_1' } });
const hand = () => ({ id: 2, type: 'hand_motion_started', at: 1000, eventVersion: 1, trackId: 'hand_1_1', sourceSeq: 77,
  observationSeq: 12, evidenceStartSeq: 10, stateRevision: 3, sourceGeneration: 1 });
const snapshot = seq => ({ v: 1, sessionId: 'test', seq, capturedAt: 1000, camera: 'absent', turn: 'idle', summary: 'PRIVATE_SUMMARY',
  user: { present: false, quality: { score: 0, basis: 'unavailable' }, position: null, head: null, facingScreen: null, expression: null, mouthMoving: null } });
const window = () => ({ schemaVersion: 1, request: request(), events: [hand()], observations: [snapshot(10), snapshot(12)] });
it('preserves full hand evidence and independent delivery/source identity in immutable data-only windows', () => {
  const raw = window(), frozen = freezeReactiveWindow(raw);
  expect(frozen.events).toEqual([hand()]); expect(frozen.events[0].id).toBe(2); expect(frozen.events[0].sourceSeq).toBe(77);
  raw.events[0].trackId = 'changed'; expect(frozen.events[0].trackId).toBe('hand_1_1'); expect(Object.isFrozen(frozen.events[0])).toBe(true);
  expect(JSON.stringify(frozen)).not.toContain('PRIVATE_SUMMARY');
  expect(freezeReactiveCandidate({ request: request(), observationWindow: window() }).observationWindow.events).toEqual([hand()]);
});
it('fails closed on unknown hand versions, missing fields, malformed evidence and absent hand read sets', () => {
  for (const patch of [{ eventVersion: 2 }, { trackId: 'bad id' }, { sourceSeq: NaN }, { stateRevision: -1 }, { sourceGeneration: 2 },
    { at: NaN }, { at: Infinity }, { evidenceStartSeq: 13 }, { observationSeq: 13 }, { pixels: 'PRIVATE' }]) {
    const value = window(); Object.assign(value.events[0], patch);
    expect(() => freezeReactiveWindow(value)).toThrow(); expect(() => freezeReactiveCandidate({ request: request(), observationWindow: value })).toThrow();
  }
  for (const field of ['eventVersion', 'sourceSeq', 'trackId', 'observationSeq', 'evidenceStartSeq', 'stateRevision', 'sourceGeneration']) {
    const value = window(); delete value.events[0][field]; expect(() => freezeReactiveWindow(value)).toThrow();
  }
  const absent = window(); delete absent.request.handReadSet;
  expect(() => freezeReactiveWindow(absent)).toThrow(); expect(() => freezeReactiveCandidate({ request: absent.request, observationWindow: absent })).toThrow();
  const duplicate = window(); duplicate.events.push({ ...hand(), id: 3 }); expect(() => freezeReactiveWindow(duplicate)).toThrow();
});
it('keeps old face clients valid without hand metadata or hand read sets', () => {
  const legacy = window(); delete legacy.request.handReadSet; legacy.events = [{ id: 1, type: 'user_arrived', at: 1000 }];
  expect(freezeReactiveWindow(legacy).events).toEqual(legacy.events);
  legacy.events[0].sourceSeq = 70; expect(freezeReactiveWindow(legacy).events[0].sourceSeq).toBe(70);
  legacy.events[0].eventVersion = 1; expect(() => freezeReactiveWindow(legacy)).toThrow();
});

it('accepts all four geometric event kinds without inventing face or body presence', () => {
  for (const type of ['hand_appeared', 'hand_lost', 'hand_motion_started', 'hand_motion_stopped']) {
    const value = window(); value.events[0].type = type;
    if (type === 'hand_lost') { value.request.requiredTrackIds = []; value.request.handReadSet.primaryTrackId = null; }
    const frozen = freezeReactiveWindow(value); expect(frozen.events[0].type).toBe(type);
    expect(frozen.observations.every(observation => observation.user.present === false)).toBe(true);
  }
});
