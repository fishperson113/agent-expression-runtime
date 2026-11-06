import { expect, it, vi } from 'vitest';
import { Compiler } from '../src/core/compiler/compiler';
import { shapeBuffers } from '../src/adapters/three-renderer';
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
