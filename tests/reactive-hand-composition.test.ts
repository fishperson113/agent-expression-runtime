import { expect, it } from 'vitest';
import { HandEventSource } from '../src/live/hand-event-source';
import { FaceObservations, type FaceSample } from '../src/live/observation';
import { ReactiveSession } from '../src/core/live/reactive-session';
import { CausalRecorder } from '../src/core/live/causal-recorder';
import type { LiveEventKind, LiveSourceEvent } from '../src/core/live/types';
import type { SessionEvent } from '../src/core/live/reactive-session-types';
import type { ReactiveRequest } from '../src/core/live/decision-types';
const { freezeReactiveCandidate } = await import(new URL('../integrations/reactive-window.mjs', import.meta.url).href);

function fixture(enabled = true) {
  let now = 0, wall = 10000, id = 0; const source = new HandEventSource(() => now), observations = new FaceObservations('hand_source');
  const admitted: unknown[] = [], cancelled: unknown[] = [], captured: LiveSourceEvent[] = [];
  const recorder = new CausalRecorder({ now: () => now, wallNow: () => wall, epoch: () => 'epoch' }); recorder.start({ runId: 'hand_test', mode: 'synthetic' });
  const session = new ReactiveSession({ now: () => now, wallNow: () => wall, epoch: () => 'epoch', id: () => `request_${++id}`,
    canAdmit: () => true, handState: () => source.handState(), admit: (...args) => admitted.push(args), cancel: (...args) => cancelled.push(args), record: (kind, value) => recorder.append(kind, value) });
  source.configure(enabled); session.configure(true); session.enable(true);
  const publish = (events: LiveSourceEvent[]) => { captured.push(...events); session.observe(observations.snapshot, events.map(event => ({ ...event, seq: event.sourceSeq! })) as SessionEvent[]); return events; };
  const sample = (x: number | null = 0.2, dt = 50, secondary = false) => {
    now += dt; wall += dt;
    const value: FaceSample = { landmarks: [], scores: {}, matrix: [], durationMs: 1, delegate: 'synthetic',
      handObservation: { v: 1, trackingState: x === null ? 'lost' : 'tracked', coordinateSpace: 'image-normalized', landmarkSchema: 'mediapipe-hand-21',
        zMeaning: 'wrist-relative-image-width', mirrored: false, sourceWidth: 640, sourceHeight: 480,
        entities: x === null ? [] : [{ detectionId: 0, handedness: 'Unknown', confidence: 0,
          landmarks: Array.from({ length: 21 }, () => ({ x, y: 0.5, z: 0 })) }] } };
    if (secondary) value.handObservation!.entities.push({ detectionId: x === null ? 0 : 1, handedness: 'Unknown', confidence: 0, landmarks: Array.from({ length: 21 }, () => ({ x: 0.8, y: 0.5, z: 0 })) });
    if (secondary) value.handObservation!.trackingState = 'tracked';
    const face = observations.update(value, wall); return publish(source.sample(observations.snapshot, face));
  };
  const cue = (type: LiveEventKind) => { observations.snapshot = { ...observations.snapshot, seq: observations.snapshot.seq + 1 }; return publish(source.publish([{ type, at: wall }])); };
  return { source, observations, session, admitted, cancelled, recorder, captured, sample, cue,
    advance: (ms: number) => { now += ms; wall += ms; }, now: () => now, wall: () => wall,
    stable: () => { for (let i = 0; i < 22; i++) sample(); return session.takeRequest()!; } };
}
const decision = (request: ReactiveRequest) => ({ schemaVersion: 1, requestId: request.requestId, decisionId: 'decision', mode: 'express', validUntil: request.deadline,
  action: { actionId: 'action', body: { type: 'wait', durationMs: 100 } } });
it('dispatches hand-only perception through strict Node contracts and keeps immutable track lineage in recorder', async () => {
  const f = fixture(), candidate = f.stable(); expect(candidate).toBeTruthy(); expect(f.observations.snapshot.camera).toBe('absent');
  expect(candidate.observationWindow.events.map(event => event.type)).toEqual(['hand_appeared']);
  const event = candidate.observationWindow.events[0]; expect('eventVersion' in event).toBe(true);
  expect(candidate.request.handReadSet?.primaryTrackId).toBe(f.observations.snapshot.hands?.primaryTrackId);
  expect(freezeReactiveCandidate(candidate).observationWindow.events[0]).toEqual(event);
  expect(f.session.authorize(candidate.request.requestId)).toBe(true);
  f.sample(0.201); expect((await f.session.deliver(candidate.request.requestId, decision(candidate.request)))?.reason).toBe('accepted');
  const bundle = f.recorder.snapshot(); expect(bundle.manifest?.incomplete).toBe(false);
  const recorded = bundle.records.find(record => record.kind === 'event')!.payload as any;
  expect(recorded.sourceSeq).toBe(event.id); expect(recorded.trackId).toBe(candidate.request.requiredTrackIds[0]);
  expect(recorded.eventVersion).toBe(1); expect(recorded.evidenceStartSeq).toBeLessThanOrEqual(recorded.observationSeq);
});
it('does not count turn-only source sequence increments as new hand evidence or collide face/hand IDs', () => {
  const f = fixture(); f.sample(); const before = f.source.handState();
  for (let i = 0; i < 50; i++) f.cue(i % 2 ? 'turn_changed' : 'mouth_started');
  expect(f.source.handState()).toEqual(before);
  for (let i = 1; i <= 5; i++) { f.advance(50); expect(f.source.sample({ ...f.observations.snapshot, seq: f.observations.snapshot.seq + i }, [])).toEqual([]); }
  expect(f.source.handState()).toEqual(before); expect(f.captured.filter(event => 'eventVersion' in event)).toEqual([]);
  for (let i = 0; i < 4; i++) f.sample(); f.cue('expression_changed');
  const ids = f.captured.map(event => event.sourceSeq); expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual([...ids].sort((a, b) => a! - b!));
});
it('keeps a disabled producer inert while legacy face windows remain accepted', () => {
  const f = fixture(false); for (let i = 0; i < 40; i++) f.sample(0.2 + i * 0.005);
  expect(f.session.takeRequest()).toBeNull(); expect(f.source.handState()).toBeUndefined();
  f.cue('expression_changed'); f.advance(750); f.sample(); const candidate = f.session.takeRequest()!;
  expect(candidate.request.handReadSet).toBeUndefined(); expect(candidate.observationWindow.events[0]).toEqual(expect.objectContaining({ type: 'expression_changed' }));
  expect('sourceSeq' in candidate.observationWindow.events[0]).toBe(false); expect(freezeReactiveCandidate(candidate)).toBeTruthy();
});
it('invalidates lost-hand absence on return before appearance debounce and retains transport until delivery', async () => {
  const f = fixture(); const first = f.stable(); f.session.authorize(first.request.requestId);
  await f.session.deliver(first.request.requestId, { ...decision(first.request), mode: 'observe', action: null });
  for (let i = 0; i < 300; i++) f.sample();
  for (let i = 0; i < 22; i++) f.sample(null);
  const absent = f.session.takeRequest()!; expect(absent.observationWindow.events[0].type).toBe('hand_lost');
  expect(absent.request.handReadSet?.primaryTrackId).toBeNull(); expect(f.session.authorize(absent.request.requestId)).toBe(true);
  const returned = f.sample(); expect(returned.some(event => event.type === 'hand_appeared')).toBe(false);
  expect(f.session.status().transport).toBe(absent.request.requestId);
  expect((await f.session.deliver(absent.request.requestId, decision(absent.request)))?.reason).toBe('stale'); expect(f.admitted).toEqual([]);
});
it('drops old hand generations and never bundles primary-A loss with primary-B absence prerequisites', () => {
  const reset = fixture(); for (let i = 0; i < 5; i++) reset.sample(); expect(reset.session.status().pending).toBe(1);
  reset.source.reset(); reset.cue('turn_changed'); expect(reset.session.status().pending).toBe(0);
  const f = fixture(); for (let i = 0; i < 5; i++) f.sample(0.2, 50, true);
  const oldPrimary = f.source.handState()!.primaryTrackId;
  for (let i = 0; i < 25; i++) f.sample(null, 50, true);
  f.sample(0.2, 50, true);
  const candidate = f.session.takeRequest()!; expect(candidate).toBeTruthy();
  expect(candidate.request.handReadSet!.primaryTrackId).not.toBe(oldPrimary);
  expect(candidate.observationWindow.events.some(event => event.type === 'hand_lost')).toBe(false);
  expect(candidate.observationWindow.events.some(event => event.type === 'hand_appeared')).toBe(true);
  expect(freezeReactiveCandidate(candidate)).toBeTruthy();
  const all = f.recorder.snapshot().records.filter(record => record.kind === 'event').map(record => record.payload as any);
  expect(all.some(event => event.type === 'hand_lost' && event.trackId === oldPrimary)).toBe(true);
});
