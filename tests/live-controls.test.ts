import { faceWrites } from '../src/core/live/face';
import { expect, it } from 'vitest';
import { LiveCompiler } from '../src/core/live/compiler';
import { validateConfiguration } from '../src/core/live/control-validation';

const bind = { type: 'bind', id: 'chosen', signal: 'agent.output', target: { part: 'p3', prop: 'scaleY' },
  gain: 0.6, offset: 1, clamp: [0.5, 1.6], smoothMs: 80 };
const config = () => ({ controls: [bind], poses: [], lifetimeMs: 60000 });
it('accepts bounded transforms while rejecting unknown signals, code and same-layer writes', () => {
  expect(validateConfiguration(config()).controls).toHaveLength(1);
  expect(() => validateConfiguration({ ...config(), controls: [{ ...bind, signal: 'user.password' }] })).toThrow('live_signal');
  expect(() => validateConfiguration({ ...config(), controls: [bind, { ...bind, id: 'other' }] })).toThrow('live_property_conflict');
  expect(() => validateConfiguration({ ...config(), code: 'run()' })).toThrow('live_fields');
  expect(() => validateConfiguration({ ...config(), lifetimeMs: Infinity })).toThrow('live_range');
});
it('compiles the complete Live command before installation and preserves legacy commands', () => {
  const compiler = new LiveCompiler(), envelope = { v: 1, epoch: 'live', seq: 1, kind: 'program', track: 'body', policy: 'replace' };
  const result = compiler.compile({ ...envelope, body: { type: 'live', program: { type: 'wait', durationMs: 100 }, configuration: config() } }, 0);
  expect(result.program.kind).toBe('program'); expect(result.configuration?.controls).toHaveLength(1);
  expect(() => compiler.compile({ ...envelope, body: { type: 'live', program: { type: 'wait', durationMs: -1 }, configuration: config() } }, 0)).toThrow();
  expect(compiler.compile({ ...envelope, body: { type: 'wait', durationMs: 10 } }, 0).configuration).toBeUndefined();
});

it('accepts staged nonoverlapping beats and rejects ambiguous or unbounded timing', () => {
  const pose = { type: 'pose', target: { part: 'body', prop: 'rotateZ' }, value: 0.2, durationMs: 600, attackMs: 100, releaseMs: 200 };
  const make = (poses: unknown[]) => ({ controls: [], poses, lifetimeMs: 2000 });
  expect(validateConfiguration(make([pose, { ...pose, delayMs: 600, value: -0.1 }])).poses).toHaveLength(2);
  expect(() => validateConfiguration(make([pose, { ...pose, delayMs: 599 }]))).toThrow('live_property_conflict');
  for (const patch of [{ delayMs: -1 }, { delayMs: 0.5 }, { attackMs: 0 }, { releaseMs: 501 }, { delayMs: 9999 }, { code: 'run' }])
    expect(() => validateConfiguration(make([{ ...pose, ...patch }]))).toThrow();
  expect(() => validateConfiguration(make([{ ...pose, delayMs: 1500 }]))).toThrow('live_pose_lease');
});

it('adds bounded anatomical movement without text, randomness or inference', () => {
  const before = faceWrites('idle', 0, 'normal', 4500), blink = faceWrites('idle', 0, 'normal', 5040);
  expect(blink.find(w => w.target.part === 'eye_left' && w.target.prop === 'scaleY')!.value).toBeLessThan(0.3);
  expect(blink.find(w => w.target.part === 'pupil_left')!.value).toBeLessThan(0.3);
  expect(before.find(w => w.target.part === 'fin')).not.toEqual(blink.find(w => w.target.part === 'fin'));
  expect(faceWrites('idle', 0, 'normal', 5040)).toEqual(blink);
  expect(faceWrites('idle', 0, 'off', 5040)).toEqual([]);
  const reduced = faceWrites('idle', 0, 'reduced', 5040);
  expect(reduced.find(w => w.target.part === 'eye_left' && w.target.prop === 'scaleY')!.value).toBeGreaterThan(0.9);
});

it('reports actionable property-specific transform bounds without changing runtime limits', () => {
  for (const [prop, low, high, family] of [['x', -0.4, 0.4, 'translation'], ['rotateX', -0.6, 0.6, 'rotation'], ['scaleX', 0.25, 2, 'scale']] as const) {
    const target = { part: 'body', prop }, pose = { type: 'pose', target, value: low, durationMs: 600 };
    const make = (value: number) => ({ controls: [], poses: [{ ...pose, value }], lifetimeMs: 1000 });
    for (const value of [low, high]) expect(() => validateConfiguration(make(value))).not.toThrow();
    const code = `live_${family}_range`;
    for (const value of [low - 0.01, high + 0.01, NaN]) expect(() => validateConfiguration(make(value))).toThrow(code);
    const control = { ...bind, target, offset: low, clamp: [low, high] };
    expect(() => validateConfiguration({ ...config(), controls: [control] })).not.toThrow();
    for (const patch of [{ offset: high + 0.01 }, { clamp: [low - 0.01, high] }])
      expect(() => validateConfiguration({ ...config(), controls: [{ ...control, ...patch }] })).toThrow(code);
  }
});
