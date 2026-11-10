import { expect, it } from 'vitest';
import { HandEventSource } from '../src/live/hand-event-source';
import { FaceObservations, type FaceSample } from '../src/live/observation';
import { ReactiveSession } from '../src/core/live/reactive-session';
import type { ReactiveRequest } from '../src/core/live/decision-types';
import type { HandWireEvent, LiveSourceEvent } from '../src/core/live/types';

function fixture(native = true, resetMetadata = true) {
  let now = 0, wall = 10000, id = 0, width = 640, sessionId = 'source', capturedOffset = 0;
  const source = new HandEventSource(() => now), observations = new FaceObservations(sessionId);
  const raw: LiveSourceEvent[] = [], records: { kind: string; payload: any }[] = [], cancelled: unknown[] = [];
  const session = new ReactiveSession({ now: () => now, wallNow: () => wall, epoch: () => 'epoch', id: () => `r${++id}`,
    canAdmit: () => true, handState: () => source.handState(), ...(resetMetadata ? { handResetVersion: () => source.resetVersion } : {}),
    admit: () => {}, cancel: (...args) => cancelled.push(args), record: (kind, payload) => records.push({ kind, payload }) });
  source.configure(true); session.configure(true); if (native) session.configureNativeConversation(true); session.enable(true);
  const sample = (x: number | null = 0.2, dt = 50, second = false) => {
    now += dt; wall += dt;
    const value: FaceSample = { landmarks: [], scores: {}, matrix: [], durationMs: 1, delegate: 'synthetic',
      handObservation: { v: 1, trackingState: x === null ? 'lost' : 'tracked', coordinateSpace: 'image-normalized', landmarkSchema: 'mediapipe-hand-21',
        zMeaning: 'wrist-relative-image-width', mirrored: false, sourceWidth: width, sourceHeight: 480,
        entities: x === null ? [] : [{ detectionId: 0, handedness: 'Unknown', confidence: 0,
          landmarks: Array.from({ length: 21 }, () => ({ x, y: 0.5, z: 0 })) }] } };
    if (second) value.handObservation!.entities.push({ detectionId: 1, handedness: 'Unknown', confidence: 0,
      landmarks: Array.from({ length: 21 }, () => ({ x: 0.8, y: 0.5, z: 0 })) });
    const face = observations.update(value, wall + capturedOffset); observations.snapshot = { ...observations.snapshot, sessionId };
    const cues = source.sample(observations.snapshot, face); raw.push(...cues);
    session.observe(observations.snapshot, cues.map(event => ({ ...event, seq: event.sourceSeq! })));
  };
  const steady = (count = 22, x: number | null = 0.2) => { for (let i = 0; i < count; i++) sample(x); };
  const finish = async (request: ReactiveRequest, visual = false) => {
    expect(session.authorize(request.requestId)).toBe(true);
    return session.deliver(request.requestId, { schemaVersion: 1, requestId: request.requestId, decisionId: `d${request.requestId}`,
      mode: visual ? 'express' : 'observe', validUntil: request.deadline,
      action: visual ? { actionId: `a${request.requestId}`, body: { type: 'wait', durationMs: 1000 } } : null });
  };
  return { source, session, raw, records, cancelled, sample, steady, finish, observations,
    width: (value: number) => { width = value; }, newSession: () => { sessionId = 'new_source'; },
    captureRewind: () => { capturedOffset = -400; }, hostRewind: () => { now -= 400; },
    async ready() { steady(); const candidate = session.takeRequest()!; expect(candidate).toBeTruthy(); await finish(candidate.request); steady(320); } };
}

it.each([299, 300, 301])('keeps raw stationary evidence and suppresses only a technical %sms reacquisition', async gap => {
  const f = fixture(); await f.ready(); const old = f.source.handState()!;
  f.sample(0.2, gap); f.steady();
  expect(f.session.takeRequest()).toBeNull();
  const raw = f.raw.filter((event): event is HandWireEvent => 'eventVersion' in event && event.type === 'hand_appeared');
  expect(raw).toHaveLength(gap > 300 ? 2 : 1);
  expect(f.records.filter(record => record.kind === 'event' && record.payload.type === 'hand_appeared')).toHaveLength(raw.length);
  expect(f.session.status().handOpportunities.suppressed).toBe(gap > 300 ? 1 : 0);
  if (gap > 300) {
    expect(f.source.handState()!.sourceGeneration).toBe(old.sourceGeneration + 1);
    expect(f.source.handState()!.primaryTrackId).not.toBe(old.primaryTrackId);
    expect(f.session.status().handOpportunities.last).toMatchObject({ reason: 'technical_hand_reacquire', observationSeq: raw[1].observationSeq });
  }
});

it('revokes the old visual owner even while suppressing a new inference opportunity', async () => {
  const f = fixture(); f.steady(); const initial = f.session.takeRequest()!;
  expect((await f.finish(initial.request, true))?.reason).toBe('accepted');
  f.sample(0.2, 301); expect(f.cancelled).toHaveLength(1); expect(f.session.status().owner).toBeNull();
  f.steady(340);
  expect(f.session.status().handOpportunities.suppressed).toBe(1);
  expect(f.session.status().pending).toBe(0); expect(f.session.takeRequest()).toBeNull();
});

it.each(['absence', 'long_gap', 'session', 'source', 'displacement', 'reset', 'intent', 'consent', 'ambiguous', 'capture_rewind', 'host_rewind'])('keeps %s eligible rather than pretending continuity', async change => {
  const f = fixture(); await f.ready();
  if (change === 'absence') f.steady(8, null);
  if (change === 'session') f.newSession();
  if (change === 'source') f.width(800);
  if (change === 'reset') f.source.reset();
  if (change === 'intent') f.session.userIntent();
  if (change === 'consent') { f.session.enable(false); f.session.enable(true); }
  if (change === 'ambiguous') f.sample(0.2, 50, true);
  if (change === 'capture_rewind') f.captureRewind();
  if (change === 'host_rewind') f.hostRewind();
  const x = change === 'displacement' ? 0.6 : 0.2;
  f.sample(x, change === 'long_gap' ? 1501 : 301); f.steady(22, x);
  const candidate = f.session.takeRequest(); expect(candidate).toBeTruthy();
  expect(f.session.status().handOpportunities.suppressed).toBe(0);
  expect(candidate!.observationWindow.events.some(event => event.type === 'hand_appeared')).toBe(true);
  await f.finish(candidate!.request);
});

it('bounds repeated jitter state without creating a backlog', async () => {
  const f = fixture(); await f.ready();
  for (let i = 0; i < 20; i++) { f.sample(0.2, 301); f.steady(); expect(f.session.takeRequest()).toBeNull(); }
  expect(f.session.status()).toMatchObject({ dispatches: 1, pending: 0, handOpportunities: { suppressed: 20 } });
  expect(f.raw.filter(event => event.type === 'hand_appeared')).toHaveLength(21);
});

it('keeps displacement during reacquisition confirmation eligible', async () => {
  const f = fixture(); await f.ready();
  f.sample(0.23, 301); f.sample(0.24); f.sample(0.25); f.steady(22, 0.26);
  const candidate = f.session.takeRequest(); expect(candidate).toBeTruthy();
  expect(f.session.status().handOpportunities.suppressed).toBe(0); await f.finish(candidate!.request);
});

it('rebuilds only an attention baseline after intent, without needing a new appearance event', async () => {
  const f = fixture(); await f.ready(); const appeared = f.raw.filter(event => event.type === 'hand_appeared').length;
  f.session.userIntent(); f.steady(6);
  expect(f.raw.filter(event => event.type === 'hand_appeared')).toHaveLength(appeared);
  f.sample(0.2, 301); f.steady();
  expect(f.raw.filter(event => event.type === 'hand_appeared')).toHaveLength(appeared + 1);
  expect(f.session.status().handOpportunities.suppressed).toBe(1);
  expect(f.session.takeRequest()).toBeNull();
});

it('does not rebuild a stable baseline from chained wrist drift after intent', async () => {
  const f = fixture(); await f.ready(); f.session.userIntent();
  for (const x of [0.2, 0.23, 0.26, 0.29, 0.32]) f.sample(x);
  f.sample(0.32, 301); f.steady(22, 0.32);
  const candidate = f.session.takeRequest(); expect(candidate).toBeTruthy();
  expect(f.session.status().handOpportunities.suppressed).toBe(0); await f.finish(candidate!.request);
});

it.each([[false, true], [true, false]])('preserves legacy or missing-provenance eligibility (native=%s metadata=%s)', async (native, metadata) => {
  const f = fixture(native, metadata); await f.ready(); f.sample(0.2, 301); f.steady();
  const candidate = f.session.takeRequest(); expect(candidate).toBeTruthy();
  expect(f.session.status().handOpportunities.suppressed).toBe(0); await f.finish(candidate!.request);
});
