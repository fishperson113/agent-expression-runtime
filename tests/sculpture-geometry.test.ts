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
