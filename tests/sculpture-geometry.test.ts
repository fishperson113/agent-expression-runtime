import Ajv from 'ajv';
import schema from '../src/contracts/protocol.schema.json';
import { Compiler } from '../src/core/compiler/compiler';
import { expect, it } from 'vitest';
import { validateSculpture } from '../src/core/geometry/validate';
import { sculptureCloud } from '../src/core/geometry/sampling';
import { ParticleFormation } from '../src/core/geometry/morph';
import { spatialAssignment } from '../src/core/geometry/assignment';
import { shapeBuffers } from '../src/core/geometry/primitives';

const scene = () => ({ parts: [
  { id: 'palm', kind: 'ellipsoid', center: [0, -0.3, 0], scale: [0.4, 0.4, 0.1], weight: 2 },
  { id: 'index', kind: 'curve', points: [[-0.15, 0, 0], [-0.3, 0.9, 0]], radius: 0.06 },
  { id: 'middle', kind: 'curve', points: [[0.1, 0, 0], [0.4, 0.9, 0]], radius: 0.06 },
] });
it('validates arbitrary bounded compositions and retains paths on malformed geometry', () => {
  const valid = validateSculpture(scene(), '$.body');
  expect(validateSculpture({ parts: [{ ...scene().parts[0], color: '#fF8800' }] }, '$').parts[0].color).toBe('#fF8800');
  for (const color of ['red', '#fff', '#ff880000', null, 4])
    expect(() => validateSculpture({ parts: [{ ...scene().parts[0], color }] }, '$')).toThrow();
  expect(valid.parts.map(p => p.id)).toEqual(['index', 'middle', 'palm']);
  const bad = scene(); bad.parts[1].points![0][0] = Infinity;
  expect(() => validateSculpture(bad, '$.body')).toThrow(expect.objectContaining({ path: '$.body.parts[1].points[0][0]' }));
  expect(() => validateSculpture({ parts: Array(25).fill(scene().parts[0]) }, '$')).toThrow();
  expect(() => validateSculpture({ parts: [scene().parts[0], scene().parts[0]] }, '$')).toThrow();
  expect(() => validateSculpture({ parts: [{ ...scene().parts[0], eval: 'run' }] }, '$')).toThrow();
  expect(() => validateSculpture({ parts: [{ ...scene().parts[0], weight: null }] }, '$')).toThrow();
});
it('samples deterministically with stable allocation regardless of part order', () => {
  const form = validateSculpture(scene(), '$');
  const a = sculptureCloud(form, 1000), b = sculptureCloud({ parts: [...form.parts].reverse() }, 1000);
  expect(a.positions).toEqual(b.positions); expect(new Set(a.partIndices).size).toBe(3);
  expect([...a.positions].every(Number.isFinite)).toBe(true);
  const map = spatialAssignment(a.positions, b.positions);
  expect(new Set(map).size).toBe(1000);
});
it('divides a fixed particle budget by relative weight without scaling geometry', () => {
  const part = { kind: 'ellipsoid', center: [0, 0, 0], scale: [0.2, 0.3, 0.4] };
  const counts = (weights: number[]) => {
    const form = validateSculpture({ parts: weights.map((weight, i) => ({ ...part, id: `p${i}`, weight })) }, '$');
    const cloud = sculptureCloud(form, 400);
    for (let i = 0; i < 400; i++) {
      const [x, y, z] = cloud.positions.slice(i * 3, i * 3 + 3);
      expect((x / 0.2) ** 2 + (y / 0.3) ** 2 + (z / 0.4) ** 2).toBeCloseTo(1, 5);
    }
    return weights.map((_, i) => [...cloud.partIndices].filter(index => index === i).length);
  };
  expect(counts([1, 1])).toEqual([200, 200]);
  expect(counts([3, 1])).toEqual([300, 100]);
  expect(counts([6, 2])).toEqual([300, 100]);
});
it('starts interrupted morphs at the exact current particle positions and reuses part identity', () => {
  const f = new ParticleFormation(512), form = validateSculpture(scene(), '$'), op = {};
  f.sample(op, form, 0.4, [1, 0, 0, 0, 0, 0, 0], 42, 0); f.tick(0);
  const before = f.points!.slice();
  const changed = structuredClone(form); changed.parts[0].motion = { pivot: [0, 0, 0], translate: [0.1, 0, 0],
    rotate: [0, 0, 0.2], periodMs: 2000, phase: 0 };
  const next = {}; f.sample(next, changed, 0, [1, 0, 0, 0, 0, 0, 0], 42, 500); f.tick(500);
  expect(f.points).toEqual(before);
  f.sample(next, changed, 1, [1, 0, 0, 0, 0, 0, 0], 42, 1000); f.tick(1000);
  expect(f.points).not.toEqual(before);
  f.sample({}, 'sphere', 0, [1, 0, 0, 0, 0, 0, 0], 42, 1100); const returning = f.points!.slice(); f.tick(1100);
  expect(f.points).toEqual(returning);
});
it('keeps the same particles on their parts when a pose changes', () => {
  const form = validateSculpture(scene(), '$'), f = new ParticleFormation(512);
  const map = spatialAssignment(shapeBuffers(512)[0], sculptureCloud(form, 512).positions);
  f.sample({}, form, 1, [1, 0, 0, 0, 0, 0, 0], 42, 0);
  const next = structuredClone(form), finger = next.parts.find(p => p.id === 'middle')!;
  if (finger.kind === 'curve') finger.points[finger.points.length - 1][0] += 0.3;
  const target = sculptureCloud(next, 512).positions;
  f.sample({}, next, 1, [0, 0, 0, 0, 0, 0, 0], 42, 500);
  for (let i = 0; i < 512; i++) for (let k = 0; k < 3; k++)
    expect(f.points![i * 3 + k]).toBeCloseTo(target[map[i] * 3 + k], 6);
});

it('interpolates part color overrides with stable particles, interruption and global fallback', () => {
  const f = new ParticleFormation(32), form = validateSculpture(scene(), '$'), weights = [1, 0, 0, 0, 0, 0, 0];
  f.sample({}, form, 1, weights, 42, 0); expect(f.colors).toBeUndefined();
  form.parts[0].color = '#ff0000'; form.parts[1].color = '#0000ff';
  const op = {}; f.sample(op, form, 0, weights, 42, 10);
  expect([...f.colors!].every(v => v === 0)).toBe(true);
  f.sample(op, form, 0.5, weights, 42, 20);
  for (let i = 0; i < 32; i++) {
    const expected = f.groups[i] === 0 ? [0.5, 0, 0, 0.5] : f.groups[i] === 1 ? [0, 0, 0.5, 0.5] : [0, 0, 0, 0];
    expect([...f.colors!.slice(i * 4, i * 4 + 4)]).toEqual(expected);
  }
  const before = f.colors!.slice(), next = structuredClone(form), replacement = {};
  next.parts[0].color = '#00ff00';
  f.sample(replacement, next, 0, weights, 42, 30); expect(f.colors).toEqual(before);
  f.sample(replacement, next, 1, weights, 42, 40);
  for (let i = 0; i < 32; i++) if (f.groups[i] === 0) expect([...f.colors!.slice(i * 4, i * 4 + 4)]).toEqual([0, 1, 0, 1]);
  const frozen = f.colors!.slice(); f.freeze(50); expect(f.colors).toEqual(frozen);
  const returning = {}; f.sample(returning, 'sphere', 0, weights, 42, 60); expect(f.colors).toEqual(frozen);
  f.sample(returning, 'sphere', 1, weights, 42, 70); expect([...f.colors!].every(v => v === 0)).toBe(true);
});

it('publishes parameterized geometry macros that the compiler can instantiate', () => {
  const validate = new Ajv({ strict: false }).compile(schema);
  const record = { v: 1, epoch: 'e', seq: 1, kind: 'define', body: {
    name: 'orb', revision: 1, params: { size: 'number', x: 'number', tint: 'string' }, body: { type: 'assemble', durationMs: 500,
      parts: [{ id: 'orb', kind: 'ellipsoid', color: { type: 'param', name: 'tint' }, center: [{ type: 'param', name: 'x' }, 0, 0],
        scale: [{ type: 'param', name: 'size' }, 0.2, 0.2] }] },
  } };
  expect(validate(record)).toBe(true);
  const compiler = new Compiler(); compiler.compile(record, 0);
  expect(compiler.compile({ v: 1, epoch: 'e', seq: 2, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'call', name: 'orb', revision: 1, args: { size: 0.5, x: 0.3, tint: '#ff8800' } } }, 0).kind).toBe('program');
  expect(() => compiler.compile({ v: 1, epoch: 'e', seq: 3, kind: 'program', track: 'body', policy: 'replace',
    body: { type: 'call', name: 'orb', revision: 1, args: { size: 0.5, x: 0.3, tint: 'orange' } } }, 0)).toThrow();
});

const rigidTrack = () => ({ group: 'fish', pivot: [0, 0, 0], keyframes: [
  { atMs: 0, translate: [0, 0, 0], rotate: [0, 0, 0] },
  { atMs: 1000, translate: [1, 0.5, 0], rotate: [0, 0, 1] },
] });
it('validates finite rigid tracks and consistent shared group definitions', () => {
  const make = () => ({ parts: scene().parts.map(p => ({ ...p, trajectory: rigidTrack() })) });
  expect(validateSculpture(make(), '$').parts).toHaveLength(3);
  const changed = make(); changed.parts[1].trajectory.keyframes[1].translate[0] = 2;
  expect(() => validateSculpture(changed, '$')).toThrow();
  for (const at of [-1, 0, 30001, Infinity]) {
    const bad = make(); bad.parts[0].trajectory.keyframes[1].atMs = at;
    expect(() => validateSculpture(bad, '$')).toThrow();
  }
  const both = { ...make().parts[0], motion: { pivot: [0, 0, 0], translate: [0, 0, 0], rotate: [0, 0, 0], periodMs: 1000, phase: 0 } };
  expect(() => validateSculpture({ parts: [both] }, '$')).toThrow();
});
it('keeps cross-part distances rigid, deterministic, and holds the endpoint without orbit', () => {
  const form = validateSculpture({ parts: scene().parts.map(p => ({ ...p, trajectory: rigidTrack() })) }, '$');
  const f = new ParticleFormation(90), op = {}, weights = [1, 0, 0, 0, 0, 0, 0];
  f.sample(op, form, 1, weights, 42, 0);
  const initial = f.points!.slice(); f.tick(500);
  const middle = f.points!.slice();
  for (const [a, b] of [[0, 30], [3, 180], [60, 240]]) {
    const distance = (p: Float32Array) => Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
    expect(distance(middle)).toBeCloseTo(distance(initial), 5);
  }
  const second = new ParticleFormation(90); second.sample({}, form, 1, weights, 42, 0);
  for (let t = 100; t <= 500; t += 100) second.tick(t);
  expect(second.points).toEqual(middle);
  f.tick(1000); const end = f.points!.slice(); f.tick(9000); expect(f.points).toEqual(end);
  expect(middle).not.toEqual(initial);
});
it('starts rigid time after assembly and pauses without idle slowdown or presence overwrite', () => {
  const form = validateSculpture({ parts: scene().parts.map(p => ({ ...p, trajectory: rigidTrack() })) }, '$');
  const f = new ParticleFormation(60), op = {}, weights = [1, 0, 0, 0, 0, 0, 0];
  f.sample(op, form, 0, weights, 42, 0); f.sample(op, form, 1, weights, 42, 1000);
  const start = f.points!.slice(); f.motionMode = 'off'; f.tick(3000); expect(f.points).toEqual(start);
  f.motionMode = 'normal'; f.quiet = true; f.tick(3500);
  const moved = f.points!.slice(); expect(moved).not.toEqual(start);
  expect(f.perform([{ partId: 'palm', pivot: [0, 0, 0], translate: [4, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] }])).toEqual(moved);
});

it('pins rigid boids through jumps and repeated timestamps without carrying stale velocity', async () => {
  const { TargetBoids } = await import('../src/core/geometry/boids');
  const boids = new TargetBoids(), groups = new Uint8Array([0, 1]), mask = new Uint8Array([1, 0]);
  boids.apply(new Float32Array([0, 0, 0, 0, 0, 0]), 2, 0, groups, true, mask);
  const moved = new Float32Array([3, 1, 0, 3, 1, 0]); boids.apply(moved, 2, 16, groups, true, mask);
  expect([...moved.slice(0, 3)]).toEqual([3, 1, 0]); expect(moved[3]).toBeLessThan(3);
  const repeated = new Float32Array([-2, 0, 0, 3, 1, 0]); boids.apply(repeated, 2, 16, groups, true, mask);
  expect([...repeated.slice(0, 3)]).toEqual([-2, 0, 0]);
  boids.apply(repeated, 2, 32, groups, true, new Uint8Array(2));
  expect([...repeated.slice(0, 3)]).toEqual([-2, 0, 0]);
});
it('keeps trajectory points immune to ambient deformation and uses one full-path fit', async () => {
  const { sampleBody, trajectorySceneBounds } = await import('../src/adapters/body-geometry');
  const { ThreeRenderer, fitCamera } = await import('../src/adapters/three-renderer');
  const { PerspectiveCamera } = await import('three');
  const { initialState } = await import('../src/core/runtime/scheduler');
  const form = validateSculpture({ parts: scene().parts.map(p => ({ ...p, trajectory: rigidTrack() })) }, '$');
  const f = new ParticleFormation(90); f.sample({}, form, 1, [1, 0, 0, 0, 0, 0, 0], 42, 0);
  const state = { ...initialState(), flowStrength: 1, flowWeights: [1, 1, 1], dispersion: 1, effortFlow: 1,
    grow: 2, spread: 2, rise: 1, advance: 1, arcOffset: 1, particleParts: f.parts, particleGroups: f.groups,
    particlePositions: f.points, presencePose: { x: 1, y: 1, roll: 1, yaw: 1, scale: 2, energy: 1, mode: 'normal', suppressed: false, updatedAt: 0, parts: [], clipCount: 0 } };
  const sampled = new Float32Array(270); sampleBody([], sampled, 90, state, 100, 1);
  expect(sampled).toEqual(f.points);
  const camera = new PerspectiveCamera(42, 1, 0.1, 100); fitCamera(camera, 1);
  const fixture = { camera, count: 90, positions: sampled, framedParts: undefined, trajectoryFit: undefined } as any;
  (ThreeRenderer.prototype as any).frameScene.call(fixture, state); const fit = fixture.trajectoryFit;
  const bounds = trajectorySceneBounds(form.parts);
  for (const time of [250, 500, 750, 1000, 4000]) {
    f.tick(time); fixture.positions = f.points!.slice();
    (ThreeRenderer.prototype as any).frameScene.call(fixture, { ...state, grow: 0.5 });
    expect(fixture.trajectoryFit).toBe(fit);
    for (let i = 0; i < fixture.positions.length; i++) expect(fixture.positions[i]).toBeCloseTo(f.points![i] * fit, 5);
  }
  expect(bounds.length).toBe(form.parts.length * 24); expect(fit).toBeGreaterThan(0); expect(fit).toBeLessThanOrEqual(1);
});
