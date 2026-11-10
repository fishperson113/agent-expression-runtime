import { expect, it } from 'vitest';
import { faceProgram, faceWrites, geometricGazeWrites, faceDefinition, isFace } from '../src/core/live/face';
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

it('keeps recentered glance pupils inside conservative eye ellipses while opening working/blinking eyes', () => {
  const parts = faceDefinition.parts as any[];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
    const gaze = geometricGazeWrites({ x, y, strength: 1 });
    for (const side of ['left', 'right']) {
      const eye = parts.find(p => p.id === 'eye_' + side), pupil = parts.find(p => p.id === 'pupil_' + side);
      const min = [0, 1].map(axis => Math.min(...eye.points.map((p: number[]) => p[axis])));
      const max = [0, 1].map(axis => Math.max(...eye.points.map((p: number[]) => p[axis])));
      const offset = (prop: string) => gaze.find(w => w.target.part === pupil.id && w.target.prop === prop)!.value;
      for (let t = 0; t < Math.PI * 2; t += 0.05) {
        const p = [pupil.center[0] + offset('x') + Math.cos(t) * pupil.scale[0], pupil.center[1] + offset('y') + Math.sin(t) * pupil.scale[1]];
        const distance = p.reduce((sum, n, axis) => sum + ((n - (min[axis] + max[axis]) / 2) / ((max[axis] - min[axis]) / 2 - eye.radius)) ** 2, 0);
        expect(distance).toBeLessThan(1);
      }
    }
  }
  const writes = faceWrites('working', 0, 'normal', 5040, 1);
  expect(writes.find(w => w.target.part === 'eye_left' && w.target.prop === 'scaleY')!.value).toBe(1);
  expect(writes.find(w => w.target.part === 'pupil_left' && w.target.prop === 'scaleY')!.value).toBe(1);
  expect(geometricGazeWrites({ x: NaN, y: 0, strength: 1 })).toEqual([]);
});
