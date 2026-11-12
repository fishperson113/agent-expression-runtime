import { expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { frameBody, fitCamera, ThreeRenderer } from '../src/adapters/three-renderer';
import { trajectorySceneBounds } from '../src/adapters/body-geometry';
import { validateSculpture } from '../src/core/geometry/validate';

const parts = validateSculpture({ parts: [{ id: 'traveler', kind: 'ellipsoid',
  center: [0, 0, 0], scale: [0.5, 0.3, 0.1], trajectory: {
    group: 'traveler', pivot: [0, 0, 0], keyframes: [
      { atMs: 0, translate: [-1.5, 0.7, 0], rotate: [0, 0, 0], easing: 'linear' },
      { atMs: 1000, translate: [1.5, -0.7, 0.3], rotate: [0, 0, 1], easing: 'smoothstep' },
    ],
  },
}] }, '$').parts;

it.each([16 / 9, 1, 9 / 16, 0.4])('fills more space without clipping full-path bounds at aspect %s', aspect => {
  const camera = new PerspectiveCamera(42, aspect, 0.1, 100); fitCamera(camera, aspect);
  const bounds = trajectorySceneBounds(parts), legacy = bounds.slice(), enlarged = bounds.slice();
  const oldFit = frameBody(legacy, legacy.length / 3, camera);
  const newFit = frameBody(enlarged, enlarged.length / 3, camera, 1, 0.75);
  expect(newFit).toBeGreaterThan(oldFit * 1.3); expect(newFit).toBeLessThanOrEqual(1);
  let extent = 0;
  for (let i = 0; i < enlarged.length; i += 3) {
    const point = new Vector3().fromArray(enlarged, i).project(camera);
    extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y));
    expect(Math.abs(point.x)).toBeLessThanOrEqual(0.75001);
    expect(Math.abs(point.y)).toBeLessThanOrEqual(0.75001);
    expect(Math.abs(point.z)).toBeLessThan(1);
  }
  expect(extent).toBeCloseTo(0.75, 5);
  const explicitLegacy = bounds.slice(); frameBody(explicitLegacy, bounds.length / 3, camera, 1, 0.44);
  expect(explicitLegacy).toEqual(legacy);
});

it('caches trajectory framing across grow changes and recomputes after resize', () => {
  const camera = new PerspectiveCamera(42, 1, 0.1, 100); fitCamera(camera, 1);
  const fixture = { camera, count: 1, positions: new Float32Array([0.2, 0.1, 0]),
    framedParts: undefined, trajectoryFit: undefined, submittedFrames: 0, lost: false,
    renderer: { setPixelRatio: vi.fn(), setSize: vi.fn() }, material: { uniforms: { dpr: { value: 1 } } },
  } as any;
  const frame = (ThreeRenderer.prototype as any).frameScene;
  frame.call(fixture, { particleParts: parts, grow: 1 }); const fit = fixture.trajectoryFit;
  for (const grow of [0.25, 2]) {
    fixture.positions = new Float32Array([0.2, 0.1, 0]);
    frame.call(fixture, { particleParts: parts, grow });
    expect(fixture.trajectoryFit).toBe(fit);
    expect(fixture.positions[0]).toBeCloseTo(0.2 * fit);
  }
  ThreeRenderer.prototype.resize.call(fixture, 400, 1000, 1);
  expect(fixture.trajectoryFit).toBeUndefined(); expect(fixture.framedParts).toBeUndefined();
  frame.call(fixture, { particleParts: parts, grow: 1 });
  expect(fixture.trajectoryFit).not.toBe(fit);
  const bounds = trajectorySceneBounds(parts);
  expect(fixture.trajectoryFit).toBe(frameBody(bounds, bounds.length / 3, camera, 1, 0.75));
});
