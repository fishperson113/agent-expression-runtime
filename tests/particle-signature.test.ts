import { expect, it } from 'vitest';
import { particleSignature } from '../src/adapters/particle-signature';
it('detects changes on each spatial axis and style without retaining geometry', () => {
  const points = new Float32Array([0.2, 0.3, 0.4]), initial = particleSignature(points, 1, [1, 0.8]);
  for (let axis = 0; axis < 3; axis++) {
    const changed = points.slice(); changed[axis] += 0.1;
    expect(particleSignature(changed, 1, [1, 0.8]), 'axis ' + axis).not.toBe(initial);
  }
  expect(particleSignature(points, 1, [1, 0.5])).not.toBe(initial);
  expect(particleSignature(points, 1, [1, 0.8])).toBe(initial);
});
