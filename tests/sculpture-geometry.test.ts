import { expect, it } from 'vitest';
import { validateSculpture } from '../src/core/geometry/validate';
import { sculptureCloud } from '../src/core/geometry/sampling';
import { ParticleFormation } from '../src/core/geometry/morph';
import { spatialAssignment } from '../src/core/geometry/assignment';

const scene = () => ({ parts: [
  { id: 'palm', kind: 'ellipsoid', center: [0, -0.3, 0], scale: [0.4, 0.4, 0.1], weight: 2 },
  { id: 'index', kind: 'curve', points: [[-0.15, 0, 0], [-0.3, 0.9, 0]], radius: 0.06 },
  { id: 'middle', kind: 'curve', points: [[0.1, 0, 0], [0.4, 0.9, 0]], radius: 0.06 },
] });
it('validates arbitrary bounded compositions and retains paths on malformed geometry', () => {
  const valid = validateSculpture(scene(), '$.body');
  expect(valid.parts.map(p => p.id)).toEqual(['index', 'middle', 'palm']);
  const bad = scene(); bad.parts[1].points![0][0] = Infinity;
  expect(() => validateSculpture(bad, '$.body')).toThrow(expect.objectContaining({ path: '$.body.parts[1].points[0][0]' }));
  expect(() => validateSculpture({ parts: Array(25).fill(scene().parts[0]) }, '$')).toThrow();
  expect(() => validateSculpture({ parts: [scene().parts[0], scene().parts[0]] }, '$')).toThrow();
  expect(() => validateSculpture({ parts: [{ ...scene().parts[0], eval: 'run' }] }, '$')).toThrow();
});
it('samples deterministically with stable allocation regardless of part order', () => {
  const form = validateSculpture(scene(), '$');
  const a = sculptureCloud(form, 1000), b = sculptureCloud({ parts: [...form.parts].reverse() }, 1000);
  expect(a.positions).toEqual(b.positions); expect(new Set(a.partIndices).size).toBe(3);
  expect([...a.positions].every(Number.isFinite)).toBe(true);
  const map = spatialAssignment(a.positions, b.positions);
  expect(new Set(map).size).toBe(1000);
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
