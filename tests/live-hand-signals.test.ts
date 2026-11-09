import { expect, it } from 'vitest';
import Ajv from 'ajv';
import { signalValue } from '../src/core/live/signals';
import { unavailableUser, type Observation } from '../src/core/live/types';
import { ObservationStore } from '../src/core/live/observation';
import { LiveCompositor } from '../src/core/live/compositor';
import { ReactiveDecisionHost } from '../src/core/live/decision-host';
import { validateConfiguration } from '../src/core/live/control-validation';
import schema from '../src/contracts/live-control.schema.json';
import capabilities from '../src/contracts/capabilities.json';

const xSignal = 'hand.primary.position.x', ySignal = 'hand.primary.position.y';
function snapshot(x = 0.2, y = 0.3): Observation {
  return { v: 1, sessionId: 'hand-test', seq: 1, capturedAt: 1000, camera: 'absent', user: unavailableUser(), turn: 'idle', summary: '',
    hands: { v: 1, trackingState: 'tracked', coordinateSpace: 'image-normalized', landmarkSchema: 'mediapipe-hand-21',
      zMeaning: 'wrist-relative-image-width', mirrored: false, sourceWidth: 640, sourceHeight: 480, primaryTrackId: 'hand_1_1',
      entities: [{ detectionId: 0, trackId: 'hand_1_1', handedness: 'Unknown', confidence: 0.9,
        landmarks: Array.from({ length: 21 }, () => ({ x, y, z: -0.1 })) }] } };
}
const configuration = () => ({ lifetimeMs: 10000, poses: [], controls: [
  { type: 'bind', id: 'follow', signal: xSignal, target: { part: 'body', prop: 'x' }, gain: 0.4, offset: 0, clamp: [-0.4, 0.4], smoothMs: 40 },
] });
it('maps symmetric unmirrored wrists into bounded scene coordinates even without a face', () => {
  expect(signalValue(xSignal, snapshot())).toBeCloseTo(0.6); expect(signalValue(ySignal, snapshot())).toBeCloseTo(0.4);
  expect(signalValue(xSignal, snapshot(0.8))).toBeCloseTo(-0.6);
  expect(signalValue(ySignal, snapshot(0.2, 0.7))).toBeCloseTo(-0.4);
  expect(signalValue(xSignal, snapshot(-2))).toBe(1); expect(signalValue(xSignal, snapshot(3))).toBe(-1);
  expect(signalValue('user.position.x', snapshot())).toBeNull();
});
it('requires visible stable primary and returns unknown for unavailable, stale or expired observations', () => {
  const value = snapshot(); value.hands!.primaryTrackId = null; expect(signalValue(xSignal, value)).toBeNull();
  value.hands!.primaryTrackId = 'hand_9_9'; expect(signalValue(xSignal, value)).toBeNull();
  delete value.hands!.primaryTrackId; expect(signalValue(xSignal, value)).toBeNull();
  for (const camera of ['stale', 'stopped', 'denied', 'error', 'starting'] as const)
    expect(signalValue(xSignal, { ...snapshot(), camera })).toBeNull();
  for (const trackingState of ['lost', 'unavailable', 'error'] as const) {
    const value = snapshot(); value.hands!.trackingState = trackingState; expect(signalValue(xSignal, value)).toBeNull();
  }
  const malformed = snapshot(); malformed.hands!.entities[0].landmarks[0].x = NaN;
  expect(signalValue(xSignal, malformed)).toBeNull();
  const store = new ObservationStore(); store.ingest(snapshot(), [], 1000);
  expect(signalValue(xSignal, store.read(0, 2501).snapshot)).toBeNull();
});
it('advertises and validates the same hand binding signals without relaxing transform bounds', () => {
  const config = validateConfiguration(configuration()); expect(config.controls[0].type).toBe('bind');
  expect(capabilities.live.signals).toEqual(expect.arrayContaining([xSignal, ySignal]));
  const validate = new Ajv().compile(schema); expect(validate({ type: 'live', program: null, configuration: configuration() })).toBe(true);
  expect(() => validateConfiguration({ ...configuration(), controls: [{ ...configuration().controls[0], clamp: [-4, 4] }] })).toThrow();
});
it('updates an authored binding while an actual decision host waits for its fake transport', async () => {
  let modelSettled = false, started = false, now = 0, finish!: (value: unknown) => void;
  const pending = new Promise<unknown>(resolve => { finish = resolve; });
  const host = new ReactiveDecisionHost(() => ({ sessionId: 'hand-test', epoch: 'test', intentRevision: 0, trackIds: ['hand_1_1'] }), () => now);
  const request = { schemaVersion: 1 as const, sessionId: 'hand-test', epoch: 'test', requestId: 'request', intentRevision: 0, deadline: 5000, requiredTrackIds: ['hand_1_1'] };
  const decision = host.run(request, { decide: () => { started = true; return pending; } }, () => { throw Error('observe must not admit'); });
  void decision.then(() => { modelSettled = true; });
  expect(started).toBe(true);
  const compositor = new LiveCompositor(); compositor.install(validateConfiguration(configuration()), 0);
  const sample = (at: number, value: Observation, blocked?: Set<string>) => { now = at; return compositor.sample(at, value, 0, blocked); };
  for (let tick = 0; tick <= 20; tick++) sample(tick * 20, snapshot());
  const before = sample(420, snapshot())[0]; expect(before.value).toBeGreaterThan(0.2);
  for (let tick = 22; tick <= 42; tick++) sample(tick * 20, snapshot(0.8));
  const after = sample(860, snapshot(0.8))[0]; expect(after.value).toBeLessThan(-0.2); expect(Math.abs(after.value)).toBeLessThanOrEqual(0.4);
  expect(modelSettled).toBe(false);
  const blocked = new Set(['body:x']);
  for (let tick = 44; tick <= 64; tick++) sample(tick * 20, snapshot(), blocked);
  expect(Math.abs(sample(1300, snapshot(), blocked)[0].value)).toBeLessThan(0.01);
  expect((await host.run({ ...request, requestId: 'second' }, { decide: async () => null }, () => {})).reason).toBe('busy');
  finish({ schemaVersion: 1, requestId: 'request', decisionId: 'observation', mode: 'observe', validUntil: 4000, action: null });
  expect((await decision).reason).toBe('observed');
});
