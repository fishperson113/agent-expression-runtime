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
function validatePart(value: unknown, path: string): Part {
  const p = object(value, ['id', 'kind', 'weight', 'color', 'motion', 'points', 'radius', 'center', 'scale', 'rotation'], path);
  if (typeof p.id !== 'string' || !/^[A-Za-z][\w-]{0,31}$/.test(p.id)) fail(path + '.id');
  scalar(p.weight === undefined ? 1 : p.weight, 0.1, 10, path + '.weight');
  if (p.color !== undefined && (typeof p.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p.color))) fail(path + '.color');
  validateMotion(p.motion, path + '.motion');
  const fields = p.kind === 'curve' ? ['points', 'radius'] : p.kind === 'ellipsoid' ? ['center', 'scale', 'rotation']
    : p.kind === 'patch' ? ['points'] : fail(path + '.kind');
  object(p, ['id', 'kind', 'weight', 'color', 'motion', ...fields], path);
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
  const seen = new Set<string>();
  parts.forEach((part: Part, i: number) => { if (seen.has(part.id)) fail(`${path}.parts[${i}].id`); seen.add(part.id); });
  return { parts: parts.sort((a: Part, b: Part) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}
