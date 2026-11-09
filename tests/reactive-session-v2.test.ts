import { CausalRecorder } from '../src/core/live/causal-recorder';
import { expect, it } from 'vitest';
import { ReactiveSession } from '../src/core/live/reactive-session';
import { FaceObservations, type FaceSample } from '../src/live/observation';
import { HandEventSource } from '../src/live/hand-event-source';
import type { SessionEvent } from '../src/core/live/reactive-session-types';
import type { ReactiveRequest, SemanticPrerequisite } from '../src/core/live/decision-types';
function fixture(version: 1 | 2 = 2) {
  let now = 0, wall = 10000, next = 0;
  const observations = new FaceObservations('source'), source = new HandEventSource(() => now), accepted: any[] = [], cancelled: any[] = [], records: any[] = [], events: string[] = [];
  const recorder = new CausalRecorder({ now: () => now, wallNow: () => wall, epoch: () => 'epoch' }); recorder.start({ runId: 'v2_live', mode: 'synthetic' });
  const session = new ReactiveSession({ now: () => now, wallNow: () => wall, epoch: () => 'epoch', id: () => `r${++next}`, canAdmit: () => true,
    handState: () => source.handState(), handMotion: () => source.handMotion(), admit: (...args) => accepted.push(args), cancel: (...args) => cancelled.push(args),
    record: (kind, payload) => { records.push({ kind, payload }); recorder.append(kind, payload); } });
  source.configure(true); session.configureContract(version); session.configure(true); session.enable(true);
  const sample = (smile = 0.1, facing = true, hand: number | null | undefined = undefined, dt = 100) => {
    now += dt; wall += dt;
    const value: FaceSample = { landmarks: Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })), scores: { mouthSmileLeft: smile, mouthSmileRight: smile },
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, facing ? 0 : 1, 0, facing ? 1 : 0.1, 0, 0, 0, 0, 1], durationMs: 1, delegate: 'synthetic',
      ...(hand === undefined ? {} : { handObservation: { v: 1 as const, trackingState: hand === null ? 'lost' as const : 'tracked' as const,
        coordinateSpace: 'image-normalized' as const, landmarkSchema: 'mediapipe-hand-21' as const, zMeaning: 'wrist-relative-image-width' as const,
        mirrored: false as const, sourceWidth: 640, sourceHeight: 480, entities: hand === null ? [] : [{ detectionId: 0, handedness: 'Unknown' as const, confidence: 0,
          landmarks: Array.from({ length: 21 }, () => ({ x: hand, y: 0.5, z: 0 })) }] } }) };
    const cues = source.sample(observations.snapshot, []);
    expect(cues).toEqual([]);
    const face = observations.update(value, wall), published = source.sample(observations.snapshot, face);
    events.push(...published.map(event => event.type)); session.observe(observations.snapshot, published.map(event => ({ ...event, seq: event.sourceSeq! })) as SessionEvent[]);
  };
  const launch = () => { for (let i = 0; i < 20; i++) sample(); const candidate = session.takeRequest()!; expect(candidate).toBeTruthy(); expect(session.authorize(candidate.request.requestId)).toBe(true); return candidate.request; };
  return { session, sample, launch, observations, source, accepted, cancelled, records, recorder, events, now: () => now,
    cameraOff: () => { observations.status('denied', wall); source.reset(); session.observe(observations.snapshot, []); } };
}
function decision(request: ReactiveRequest, prerequisites: SemanticPrerequisite[] = []) {
  return { schemaVersion: request.schemaVersion, requestId: request.requestId, decisionId: 'decision', mode: 'express', validUntil: request.deadline,
    ...(request.schemaVersion === 2 ? { prerequisites } : {}), action: { actionId: 'action', body: { type: 'sequence', children: [{ type: 'parallel', children: [
      { type: 'shapeQuality', rise: 0.1, grow: 1.1, effort: { time: 0.5, weight: 0.4, flow: 0.5 }, durationMs: 500 },
    ] }] } } };
}
it('keeps V2 generic two-second decisions live under actual 0.5Hz expression churn while V1 still revokes', async () => {
  for (const version of [1, 2] as const) {
    const f = fixture(version), request = f.launch();
    for (let i = 1; i <= 20; i++) f.sample(Math.floor(i / 10) % 2 ? 0.9 : 0.1);
    expect(f.events).toContain('expression_changed'); expect(f.accepted).toEqual([]); expect(f.session.status().transport).toBe(request.requestId);
    const result = await f.session.deliver(request.requestId, decision(request));
    expect(result?.reason).toBe(version === 2 ? 'accepted' : 'revoked'); expect(f.accepted).toHaveLength(version === 2 ? 1 : 0);
    if (version === 2) {
      expect(request.schemaVersion).toBe(2); expect((request as any).semanticSnapshot.handIdentity).toEqual(expect.any(Number));
      const recorded = f.records.find(record => record.kind === 'decision').payload;
      expect(recorded.decisionVersion).toBe(2); expect(recorded.prerequisites).toEqual([]); expect(recorded.executionValidUntil).toBe(f.now() + 600);
      const bundle = f.recorder.snapshot(); expect(bundle.manifest!.incomplete).toBe(false);
      expect(bundle.records.find(record => record.kind === 'request')!.payload).toMatchObject({ request: { schemaVersion: 2, semanticSnapshot: expect.any(Object) } });
      expect(bundle.records.find(record => record.kind === 'decision')!.payload).toMatchObject({ decisionVersion: 2, prerequisites: [], executionValidUntil: f.now() + 600 });
    }
  }
});
it('rejects selected expression and immediate orientation dependencies without blanket generic revocation', async () => {
  const expression = fixture(), first = expression.launch();
  for (let i = 1; i <= 20; i++) expression.sample(Math.floor(i / 10) % 2 ? 0.9 : 0.1);
  expect((await expression.session.deliver(first.requestId, decision(first, ['expression'])))?.reason).toBe('stale');
  for (const selected of [false, true]) {
    const f = fixture(), request = f.launch(); f.sample(0.1, false);
    expect(f.events).not.toContain('looked_away');
    expect((await f.session.deliver(request.requestId, decision(request, selected ? ['orientation'] : [])))?.reason).toBe(selected ? 'stale' : 'accepted');
  }
});
it('keeps unchanged negotiation idempotent and still revokes on user, stop, permission and contract changes', async () => {
  const compatible = fixture(), request = compatible.launch(); compatible.session.configureContract(2);
  expect((await compatible.session.deliver(request.requestId, decision(request)))?.reason).toBe('accepted');
  for (const change of [(f: ReturnType<typeof fixture>) => f.session.userIntent(), (f: ReturnType<typeof fixture>) => f.session.enable(false),
    (f: ReturnType<typeof fixture>) => f.cameraOff(), (f: ReturnType<typeof fixture>) => f.session.configureContract(1)]) {
    const f = fixture(), current = f.launch(); change(f);
    expect((await f.session.deliver(current.requestId, decision(current)))?.reason).toBe('revoked'); expect(f.accepted).toEqual([]);
  }
});
it('captures critical lost-hand absence and rejects return before another appearance event even with no optional prerequisites', async () => {
  const f = fixture(); for (let i = 0; i < 4; i++) f.sample(0.1, true, 0.2, 50);
  for (let i = 0; i < 25; i++) f.sample(0.1, true, null, 50);
  const candidate = f.session.takeRequest()!; expect(candidate).toBeTruthy(); expect(candidate.request.handReadSet?.primaryTrackId).toBeNull();
  expect(f.session.authorize(candidate.request.requestId)).toBe(true); const count = f.events.filter(type => type === 'hand_appeared').length;
  f.sample(0.1, true, 0.2, 50); expect(f.events.filter(type => type === 'hand_appeared')).toHaveLength(count);
  expect((await f.session.deliver(candidate.request.requestId, decision(candidate.request)))?.reason).toBe('revoked'); expect(f.accepted).toEqual([]);
});
it('does not waive known hand data when its trusted hand state is unavailable', () => {
  let now = 1000; const session = new ReactiveSession({ now: () => now, wallNow: () => now, epoch: () => 'e', id: () => 'r', canAdmit: () => true, admit: () => {}, cancel: () => {} });
  session.configureContract(2); session.configure(true); session.enable(true); const f = fixture(); f.sample(0.1, true, 0.2);
  const snapshot = { ...f.observations.snapshot, capturedAt: now };
  session.observe(snapshot, [{ type: 'expression_changed', seq: 1, at: now }]); now += 750;
  session.observe({ ...snapshot, seq: snapshot.seq + 1, capturedAt: now }, []); expect(session.takeRequest()).toBeNull();
});
it('uses the bounded V2 execution lease after a 4.9-second decision without extending the admission deadline', async () => {
  const f = fixture(), request = f.launch();
  for (let i = 0; i < 49; i++) f.sample();
  const result = await f.session.deliver(request.requestId, decision(request)); expect(result?.reason).toBe('accepted');
  for (let i = 0; i < 2; i++) f.sample();
  expect(f.now()).toBeGreaterThan(request.deadline); expect(f.session.status().owner).toBe('action'); expect(f.cancelled).toEqual([]);
  for (let i = 0; i < 4; i++) f.sample();
  expect(f.session.status().owner).toBeNull(); expect(f.cancelled).toHaveLength(1);
  const expired = fixture(), old = expired.launch(); for (let i = 0; i < 50; i++) expired.sample();
  expect((await expired.session.deliver(old.requestId, decision(old)))?.reason).not.toBe('accepted'); expect(expired.accepted).toEqual([]);
});
