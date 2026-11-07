import { expect, it } from 'vitest';
import { TargetBoids } from '../src/core/geometry/boids';

it('converges to precise target geometry instead of collapsing into a flock', () => {
  const swarm = new TargetBoids(), initial = new Float32Array([-0.5, 0, 0, 0.5, 0, 0]);
  swarm.apply(initial, 2, 0);
  const goal = new Float32Array([-0.3, 0.7, 0, 0.3, 0.7, 0]);
  const first = goal.slice(); swarm.apply(first, 2, 16);
  expect(first).not.toEqual(goal);
  for (let i = 2; i < 160; i++) { const frame = goal.slice(); swarm.apply(frame, 2, i * 16); if (i === 159) expect(frame).toEqual(goal); }
});
it('does not align or cohere particles belonging to different parts', () => {
  const together = new TargetBoids(), a = new TargetBoids(), b = new TargetBoids();
  together.apply(new Float32Array([0, 0, 0, 0.01, 0, 0]), 2, 0, new Uint8Array([0, 1]));
  a.apply(new Float32Array([0, 0, 0]), 1, 0); b.apply(new Float32Array([0.01, 0, 0]), 1, 0);
  for (let frame = 1; frame < 30; frame++) {
    const combined = new Float32Array([0.5, 0, 0, -0.5, 0, 0]), left = combined.slice(0, 3), right = combined.slice(3);
    together.apply(combined, 2, frame * 16, new Uint8Array([0, 1])); a.apply(left, 1, frame * 16); b.apply(right, 1, frame * 16);
    expect(combined).toEqual(new Float32Array([...left, ...right]));
  }
});
it('bounds neighbour work in dense swarms and remains finite after a long frame gap', () => {
  const count = 2000, swarm = new TargetBoids();
  const points = Float32Array.from({ length: count * 3 }, (_, i) => Math.sin(i) * 0.01);
  swarm.apply(points.slice(), count, 0);
  const moved = Float32Array.from(points, x => x + 0.5); swarm.apply(moved, count, 60000);
  expect(swarm.info.neighbourChecks).toBeLessThanOrEqual(count * swarm.info.maxChecksPerParticle);
  expect([...moved].every(Number.isFinite)).toBe(true);
  swarm.apply(points, count, 60016, undefined, false); expect(swarm.info.mode).toBe('off');
});
it('uses flock interaction within a part, without snapping at repeated timestamps', () => {
  const flock = new TargetBoids(), separated = new TargetBoids();
  const initial = new Float32Array([0, 0, 0, 0.01, 0, 0]);
  flock.apply(initial.slice(), 2, 0); separated.apply(initial.slice(), 2, 0);
  const a = new Float32Array([0.5, 0, 0, -0.5, 0, 0]), b = a.slice();
  flock.apply(a, 2, 16); separated.apply(b, 2, 16, new Uint8Array([0, 1]));
  expect(a).not.toEqual(b);
  const repeated = new Float32Array([1, 0, 0, -1, 0, 0]); flock.apply(repeated, 2, 16);
  expect(repeated).toEqual(a);
});
