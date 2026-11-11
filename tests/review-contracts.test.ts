import { expect, it, vi } from 'vitest';
import { Compiler } from '../src/core/compiler/compiler';
import { shapeBuffers, fitCamera, frameBody } from '../src/adapters/three-renderer';
import { PerspectiveCamera, Vector3 } from 'three';
import { capability } from '../src/primitives/registry';
it('every advertised shape has a finite deterministic particle buffer', () => {
  const first = shapeBuffers(100, 42),
    second = shapeBuffers(100, 42);
  expect(first).toHaveLength(capability.shapes.length);
  for (let i = 0; i < first.length; i++) {
    expect(first[i]).toEqual(second[i]);
    expect([...first[i]].every(Number.isFinite)).toBe(true);
  }
  expect(capability.shapes).toEqual(
    expect.arrayContaining(['sphere', 'wall', 'pin', 'screw', 'pyramid']),
  );
  expect(capability.shapes).not.toContain('ring');
});
it.each([16 / 9, 9 / 16])('world separation along the view ray can project to overlap at aspect %s', aspect => {
  const camera = new PerspectiveCamera(42, aspect, 0.1, 100);
  fitCamera(camera, aspect); camera.updateMatrixWorld();
  const origin = new Vector3().project(camera);
  const offset = new Vector3(0, 0.15, 0.38).project(camera);
  expect(offset.x).toBeCloseTo(origin.x, 10);
  expect(offset.y).toBeCloseTo(origin.y, 10);
  expect(Math.abs(offset.z - origin.z)).toBeGreaterThan(0.0001);
});
const program = (target: string) => ({
  v: 1,
  epoch: 'e',
  seq: 1,
  kind: 'program',
  track: 'body',
  policy: 'replace',
  body: { type: 'morph', target, durationMs: 100 },
});
it('rejects removed ring and renders wall as an upright thin plane', () => {
  expect(() => new Compiler().compile(program('ring'), 0)).toThrow();
  expect(() => new Compiler().compile(program('wall'), 0)).not.toThrow();
  const wall = shapeBuffers(100)[1];
  let maxX = 0,
    maxY = 0,
    maxZ = 0;
  for (let i = 0; i < wall.length; i += 3) {
    maxX = Math.max(maxX, Math.abs(wall[i]));
    maxY = Math.max(maxY, Math.abs(wall[i + 1]));
    maxZ = Math.max(maxZ, Math.abs(wall[i + 2]));
  }
  expect(maxX).toBeGreaterThan(0.8);
  expect(maxY).toBeGreaterThan(0.8);
  expect(maxZ).toBeLessThanOrEqual(0.021);
});
it('cache hits bypass lowering and cached IR is isolated from caller mutation', () => {
  const c = new Compiler();
  const lower = vi.spyOn(c as any, 'lower');
  const first = c.compile(program('wall'), 0) as any;
  first.ops[0].value = 'corrupt';
  const second = c.compile(program('wall'), 1) as any;
  expect(lower).toHaveBeenCalledTimes(1);
  expect(second.ops[0].value).toBe('wall');
});
it('the configured seed reaches IR and changes procedural targets deterministically', () => {
  expect((new Compiler(123).compile(program('wall'), 0) as any).seed).toBe(123);
  expect(shapeBuffers(10, 123)[0]).not.toEqual(shapeBuffers(10, 124)[0]);
});
it('upright shapes preserve sphere particle latitude and shorten the wall morph', () => {
  const shapes = shapeBuffers(10000), sphere = shapes[capability.shapes.indexOf('sphere')];
  for (const name of ['wall', 'cloud', 'pyramid']) {
    const shape = shapes[capability.shapes.indexOf(name)];
    for (let i = 0; i < sphere.length; i += 3) expect(sphere[i + 1] * shape[i + 1]).toBeGreaterThanOrEqual(0);
  }
  const wall = shapes[capability.shapes.indexOf('wall')];
  let distance = 0;
  for (let i = 0; i < sphere.length; i += 3)
    distance += Math.hypot(sphere[i] - wall[i], sphere[i + 1] - wall[i + 1], sphere[i + 2] - wall[i + 2]);
  expect(distance / 10000).toBeCloseTo(0.922, 2);
  const pyramid = shapes[capability.shapes.indexOf('pyramid')];
  for (let i = 0; i < pyramid.length; i += 3)
    if (pyramid[i + 1] > 0.9) expect(Math.abs(pyramid[i])).toBeLessThan(0.051);
});
it.each([16 / 9, 9 / 16, 0.4])('contains every shapeQuality boundary combination at aspect %s', aspect => {
  const camera = new PerspectiveCamera(42, aspect, 0.1, 100), point = new Vector3();
  fitCamera(camera, aspect);
  for (const shape of shapeBuffers(200)) for (const rise of [-1, 1]) for (const advance of [-1, 1])
    for (const grow of [0.25, 2]) for (const spread of [0.25, 2]) {
      const positions = shape.slice();
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] = positions[i] * grow * spread + 0.25;
        positions[i + 1] = positions[i + 1] * grow + rise;
        positions[i + 2] = positions[i + 2] * grow + advance;
      }
      frameBody(positions, positions.length / 3, camera);
      for (let i = 0; i < positions.length; i += 3) {
        point.fromArray(positions, i).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(0.881);
        expect(Math.abs(point.y)).toBeLessThan(0.881);
        expect(Math.abs(point.z)).toBeLessThan(1);
      }
    }
});
it.each([16 / 9, 9 / 16, 0.4])('reserves framing headroom so grow remains visible at aspect %s', aspect => {
  const camera = new PerspectiveCamera(42, aspect, 0.1, 100), point = new Vector3(); fitCamera(camera, aspect);
  const wall = shapeBuffers(200)[capability.shapes.indexOf('wall')];
  const extent = (grow: number) => {
    const positions = wall.map(value => value * grow); frameBody(positions, positions.length / 3, camera, grow);
    let maximum = 0;
    for (let i = 0; i < positions.length; i += 3) {
      point.fromArray(positions, i).project(camera); maximum = Math.max(maximum, Math.abs(point.x), Math.abs(point.y));
    }
    return maximum;
  };
  const neutral = extent(1), expanded = extent(1.3), largest = extent(2);
  expect(expanded / neutral).toBeGreaterThan(1.2); expect(largest / expanded).toBeGreaterThan(1.3);
  expect(largest).toBeLessThanOrEqual(0.881);
});
