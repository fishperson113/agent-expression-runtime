import { expect, it } from 'vitest';
import { faceProgram, faceWrites, geometricGazeWrites, faceDefinition, hasCanonicalFaceComponent, isFace } from '../src/core/live/face';
import type { Part } from '../src/core/geometry/types';
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
it('moves both pupils toward the cue from neutral throughout the entry envelope', () => {
  for (const direction of [-1, 1]) {
    let previous = 0;
    for (const strength of [0, 0.02, 0.04, 0.08, 0.25, 0.5, 1]) {
      const writes = geometricGazeWrites({ x: direction * 0.7 * strength, y: 0, strength });
      for (const part of ['pupil_left', 'pupil_right']) {
        const x = writes.find(w => w.target.part === part && w.target.prop === 'x')!.value;
        expect(x * direction).toBeGreaterThanOrEqual(previous);
      }
      previous = 0.7 * strength * 0.12;
    }
  }
});

it('recognizes only current default anatomy and leaves old authored face geometry alone', () => {
  const old = structuredClone(faceDefinition.parts) as any[];
  old.find(p => p.id === 'pupil_left').center[0] = -0.465;
  old.find(p => p.id === 'pupil_right').center[0] = 1.02;
  expect(isFace(old)).toBe(false); expect(isFace(faceDefinition.parts as any)).toBe(true);
});

it('recognizes only the complete exact canonical component, never part names or partial anatomy', () => {
  const face = structuredClone(faceDefinition.parts) as any[];
  const symbol: Part = { id: 'agent_chosen', kind: 'ellipsoid', center: [1.7, 1.6, 0], scale: [0.1, 0.1, 0.1] };
  const compound = [...face, symbol].reverse();
  expect(hasCanonicalFaceComponent(compound)).toBe(true); expect(isFace(compound)).toBe(false);
  expect(hasCanonicalFaceComponent([symbol])).toBe(false);
  expect(hasCanonicalFaceComponent(face.slice(1))).toBe(false);
  const modified = structuredClone(compound); modified.find(p => p.id === 'mouth').radius *= 1.1;
  expect(hasCanonicalFaceComponent(modified)).toBe(false);
  expect(hasCanonicalFaceComponent([...compound, symbol])).toBe(false);
});
