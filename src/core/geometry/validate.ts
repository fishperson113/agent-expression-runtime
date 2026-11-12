import { ExpressionError } from '../ast/types';
import type { Part, Sculpture } from './types';
import { capability } from '../../primitives/registry';

const fail = (path: string): never => { throw new ExpressionError('geometry', path); };
function object(value: unknown, keys: string[], path: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const result = value as Record<string, any>;
  for (const key of Object.keys(result)) if (!keys.includes(key)) fail(path + '.' + key);
  return result;
}
function scalar(value: unknown, low: number, high: number, path: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(path);
}
function vector(value: unknown, low: number, high: number, path: string) {
  if (!Array.isArray(value) || value.length !== 3) fail(path);
  (value as unknown[]).forEach((x, i) => scalar(x, low, high, `${path}[${i}]`));
}
function validateMotion(value: unknown, path: string) {
  if (value === undefined || value === null) return;
  const motion = object(value, ['pivot', 'translate', 'rotate', 'periodMs', 'phase'], path);
  vector(motion.pivot, -2, 2, path + '.pivot');
  vector(motion.translate, -0.4, 0.4, path + '.translate');
  vector(motion.rotate, -0.6, 0.6, path + '.rotate');
  scalar(motion.periodMs, 1000, 10000, path + '.periodMs');
  scalar(motion.phase, 0, Math.PI * 2, path + '.phase');
}
function validateTrajectory(value: unknown, path: string) {
  if (value === undefined) return;
  const track = object(value, ['group', 'pivot', 'keyframes'], path);
  if (typeof track.group !== 'string' || !/^[A-Za-z][\w-]{0,31}$/.test(track.group)) fail(path + '.group');
  vector(track.pivot, -2, 2, path + '.pivot');
  if (!Array.isArray(track.keyframes) || track.keyframes.length < 2 || track.keyframes.length > 32) fail(path + '.keyframes');
  let previous = -1;
  track.keyframes.forEach((value: unknown, i: number) => {
    const at = `${path}.keyframes[${i}]`, frame = object(value, ['atMs', 'translate', 'rotate', 'easing'], at);
    scalar(frame.atMs, 0, 30000, at + '.atMs');
    if ((i === 0 && frame.atMs !== 0) || frame.atMs <= previous) fail(at + '.atMs');
    previous = frame.atMs;
    vector(frame.translate, -4, 4, at + '.translate');
    vector(frame.rotate, -Math.PI, Math.PI, at + '.rotate');
    if (frame.easing !== undefined && !['linear', 'smoothstep'].includes(frame.easing)) fail(at + '.easing');
  });
}
function validateGroups(parts: Part[], path: string) {
  const groups = new Map<string, string>();
  parts.forEach((part, i) => {
    if (!part.trajectory) return;
    const track = part.trajectory;
    const signature = JSON.stringify([track.pivot, track.keyframes.map(f => [f.atMs, f.translate, f.rotate, f.easing ?? 'linear'])]);
    if (groups.has(track.group) && groups.get(track.group) !== signature) fail(`${path}.parts[${i}].trajectory`);
    groups.set(track.group, signature);
  });
}
function validatePart(value: unknown, path: string): Part {
  const p = object(value, ['id', 'kind', 'weight', 'color', 'motion', 'trajectory', 'points', 'radius', 'center', 'scale', 'rotation'], path);
  if (typeof p.id !== 'string' || !/^[A-Za-z][\w-]{0,31}$/.test(p.id)) fail(path + '.id');
  scalar(p.weight === undefined ? 1 : p.weight, 0.1, 10, path + '.weight');
  if (p.color !== undefined && (typeof p.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p.color))) fail(path + '.color');
  validateMotion(p.motion, path + '.motion');
  validateTrajectory(p.trajectory, path + '.trajectory');
  if (p.trajectory !== undefined && p.motion != null) fail(path + '.trajectory');
  const fields = p.kind === 'curve' ? ['points', 'radius'] : p.kind === 'ellipsoid' ? ['center', 'scale', 'rotation']
    : p.kind === 'patch' ? ['points'] : fail(path + '.kind');
  object(p, ['id', 'kind', 'weight', 'color', 'motion', 'trajectory', ...fields], path);
  if (p.kind === 'ellipsoid') {
    vector(p.center, -2, 2, path + '.center'); vector(p.scale, 0.02, 1.5, path + '.scale');
    if (p.rotation !== undefined) vector(p.rotation, -Math.PI, Math.PI, path + '.rotation');
  } else {
    const limit = capability.assembly.controlPoints;
    if (!Array.isArray(p.points) || (p.kind === 'patch' ? p.points.length !== 4 : p.points.length < 2 || p.points.length > limit))
      fail(path + '.points');
    p.points.forEach((point: unknown, i: number) => vector(point, -2, 2, `${path}.points[${i}]`));
    if (p.kind === 'curve') scalar(p.radius, 0, 0.25, path + '.radius');
  }
  return structuredClone(p) as Part;
}
export function validateSculpture(value: unknown, path: string): Sculpture {
  const scene = object(value, ['parts'], path);
  if (!Array.isArray(scene.parts) || !scene.parts.length || scene.parts.length > capability.assembly.parts) fail(path + '.parts');
  const parts = scene.parts.map((part: unknown, i: number) => validatePart(part, `${path}.parts[${i}]`));
  validateGroups(parts, path);
  const seen = new Set<string>();
  parts.forEach((part: Part, i: number) => { if (seen.has(part.id)) fail(`${path}.parts[${i}].id`); seen.add(part.id); });
  return { parts: parts.sort((a: Part, b: Part) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}
