import { expect, it } from 'vitest';
import { faceProgram, faceWrites, isFace } from '../src/core/live/face';
import { LiveCompiler } from '../src/core/live/compiler';

it('declares readable facial parts and compiles a bounded resting assembly', () => {
  const program = faceProgram();
  expect(program.type).toBe('parallel');
  const compiler = new LiveCompiler();
  const compiled = compiler.compile({ v: 1, epoch: 'test', seq: 1, kind: 'program', track: 'body', policy: 'replace', body: program }, 0);
  const shape = compiled.program.kind === 'program' && compiled.program.ops.find(op => op.property === 'shape')?.value;
  expect(typeof shape).toBe('object');
  expect(isFace((shape as any).parts)).toBe(true);
  const wire = JSON.parse(JSON.stringify((shape as any).parts, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value));
  expect(isFace(wire)).toBe(true);
  expect(isFace([{ id: 'eye_left', kind: 'ellipsoid', center: [0, 0, 0], scale: [1, 1, 1] }])).toBe(false);
});
it('makes lifecycle states distinct through declared parts, respecting reduced/off and unrelated topology', () => {
  const idle = faceWrites('idle', 0, 'normal');
  expect(faceWrites('working', 0, 'normal')).not.toEqual(idle);
  expect(faceWrites('replying', 0.8, 'normal')).not.toEqual(idle);
  expect(faceWrites('attention', 0, 'normal')).not.toEqual(idle);
  expect(faceWrites('working', 0, 'off')).toEqual([]);
  const normal = faceWrites('working', 0, 'normal'), reduced = faceWrites('working', 0, 'reduced');
  expect(reduced.find(write => write.target.prop === 'rotateZ')!.value).toBeCloseTo(normal.find(write => write.target.prop === 'rotateZ')!.value * 0.08);
});
