import { expect, it } from 'vitest';
import { ParticleFormation } from '../src/core/geometry/morph';
import type { Part, Sculpture } from '../src/core/geometry/types';
const weights = [1, 0, 0, 0, 0, 0, 0];
const part = (id: string, x = 0): Part => ({ id, kind: 'ellipsoid', center: [x, 0, 0], scale: [0.2, 0.3, 0.1],
  motion: { pivot: [0, 0, 0], translate: [0.1, 0, 0], rotate: [0, 0, 0], periodMs: 2000, phase: 0 } });
const start = (form: Sculpture) => { const f = new ParticleFormation(120); f.sample({}, form, 1, weights, 42, 0); return f; };
const xyz = (f: ParticleFormation, i: number) => [...f.points!.slice(i * 3, i * 3 + 3)];
it('keeps retained samples and active sway while allocating a bounded new part', () => {
  const form = { parts: [part('body')] }, f = start(form), control = start(form);
  f.tick(300); control.tick(300);
  const before = f.points!.slice(), op = {};
  f.sample(op, { parts: [...form.parts, part('prop', 1)] }, 0, weights, 42, 300);
  expect(f.points).toEqual(before);
  f.tick(450); control.tick(450);
  for (let i = 0; i < 120; i++) if (f.groups[i] === 0) expect(xyz(f, i)).toEqual(xyz(control, i));
  expect([...f.groups].filter(g => g === 0)).toHaveLength(60);
  expect(f.points!.length).toBe(360);
  expect(f.points).not.toEqual(before);
});
it('retains all surviving samples when removing another part', () => {
  const form = { parts: [part('body'), part('prop', 1)] }, f = start(form), control = start(form);
  const groups = f.groups.slice(); f.tick(300); control.tick(300);
  f.sample({}, { parts: [form.parts[0]] }, 0, weights, 42, 300); f.tick(450); control.tick(450);
  for (let i = 0; i < 120; i++) if (groups[i] === 0) expect(xyz(f, i)).toEqual(xyz(control, i));
});
it('interpolates edited geometry rather than incorrectly preserving a reused ID', () => {
  const form = { parts: [part('body'), part('prop', 1)] }, f = start(form), before = f.points!.slice();
  const op = {}; f.sample(op, { parts: [form.parts[0], part('prop', 2)] }, 0, weights, 42, 0);
  expect(f.points).toEqual(before);
  f.sample(op, { parts: [form.parts[0], part('prop', 2)] }, 1, weights, 42, 0);
  for (let i = 0; i < 120; i++) if (f.groups[i] === 1) expect(f.points![i * 3] - before[i * 3]).toBeCloseTo(1);
});
it('pauses retained motion in off mode and resets changed motion', () => {
  const form = { parts: [part('body')] }, f = start(form); f.tick(300);
  f.motionMode = 'off'; const before = f.points!.slice();
  f.sample({}, { parts: [...form.parts, part('prop', 1)] }, 0, weights, 42, 300); f.tick(900);
  expect(f.points).toEqual(before);
  const changed = part('body'); changed.motion!.phase = Math.PI / 2;
  const fresh = start({ parts: [changed] }), edited = start(form); edited.tick(300);
  edited.sample({}, { parts: [changed] }, 1, weights, 42, 300);
  expect(edited.points).toEqual(fresh.points);
});
it('keeps shared trajectories synchronized when group membership changes', () => {
  const track = { group: 'shared', pivot: [0, 0, 0] as [number, number, number], keyframes: [
    { atMs: 0, translate: [0, 0, 0] as [number, number, number], rotate: [0, 0, 0] as [number, number, number] },
    { atMs: 1000, translate: [1, 0, 0] as [number, number, number], rotate: [0, 0, 0] as [number, number, number] }] };
  const body = { ...part('body'), trajectory: track }, f = start({ parts: [body] }); f.tick(500);
  const form = { parts: [body, { ...part('prop', 1), trajectory: track }] };
  f.sample({}, form, 1, weights, 42, 500);
  const expected = start(form);
  const sortedX = (v: ParticleFormation) => Array.from({ length: 120 }, (_, i) => v.points![i * 3]).sort((a, b) => a - b);
  expect(sortedX(f)).toEqual(sortedX(expected));
  f.tick(750); expect(sortedX(f)).not.toEqual(sortedX(expected));
  f.sample({}, structuredClone(form), 1, weights, 42, 750);
  expect(sortedX(f)).toEqual(sortedX(expected));
  const continuing = start({ parts: [body] }), control = start({ parts: [body] });
  continuing.tick(300); control.tick(300);
  continuing.sample({}, { parts: [body, part('other', 1)] }, 0, weights, 42, 300);
  continuing.tick(500); control.tick(500);
  for (let i = 0; i < 120; i++) if (continuing.groups[i] === 0) expect(xyz(continuing, i)).toEqual(xyz(control, i));
});
it('does not preserve samples after freeze', () => {
  const form = { parts: [part('body')] }, f = start(form); f.tick(300); f.freeze(300);
  const before = f.points!.slice(); f.sample({}, form, 0, weights, 42, 300); f.tick(600);
  expect(f.points).toEqual(before);
});
it('replays an identical full-scene operation instead of inheriting its motion clock', () => {
  const form = { parts: [part('body')] }, f = start(form), initial = f.points!.slice(); f.tick(400);
  expect(f.points).not.toEqual(initial);
  f.sample({}, structuredClone(form), 1, weights, 42, 400);
  expect(f.points).toEqual(initial);
});
it('recognizes unchanged geometry regardless of object key insertion order', () => {
  const original = part('body'), f = start({ parts: [original] }), control = start({ parts: [original] });
  const reordered = Object.fromEntries(Object.entries(original).reverse()) as Part;
  f.tick(300); control.tick(300);
  f.sample({}, { parts: [reordered, part('prop', 1)] }, 0, weights, 42, 300);
  f.tick(450); control.tick(450);
  for (let i = 0; i < 120; i++) if (f.groups[i] === 0) expect(xyz(f, i)).toEqual(xyz(control, i));
});

it('starts replacement of an unfinished transition at the displayed positions', () => {
  const form = { parts: [part('body')] }, f = start(form);
  f.sample({}, { parts: [form.parts[0], part('prop', 1)] }, 0.4, weights, 42, 300);
  const before = f.points!.slice();
  f.sample({}, { parts: [form.parts[0], part('prop', 1), part('extra', -1)] }, 0, weights, 42, 300);
  expect(f.points).toEqual(before);
  f.tick(450);
  expect(f.points).toEqual(before);
});
