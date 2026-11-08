import definition from './face.json';
import type { Node } from '../ast/types';
import type { Part } from '../geometry/types';
import type { TransformProperty } from './control-types';
import { neutral } from './control-types';
import type { TransformWrite } from './compositor';

export const faceDefinition = definition;
const canonical = (parts: Part[]) => JSON.stringify([...parts].sort((a, b) => a.id.localeCompare(b.id)), (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
const identity = canonical(definition.parts as Part[]);
export const isFace = (parts: Part[]) => canonical(parts) === identity;

export function faceProgram(durationMs = 600): Node {
  return { type: 'parallel', children: [
    { type: 'assemble', parts: structuredClone(definition.parts) as Part[], durationMs },
    { type: 'flow', field: 'pulse', strength: 0, durationMs },
    { type: 'style', pointSize: 1.8, brightness: 0.85, dispersion: 0, durationMs },
  ] };
}
export function faceWrites(activity: string, output: number, mode: 'normal' | 'reduced' | 'off'): TransformWrite[] {
  if (mode === 'off') return [];
  const writes = new Map<string, TransformWrite>();
  for (const pose of Object.values(definition.states).flat()) {
    const part = definition.roles[pose.role as keyof typeof definition.roles], prop = pose.prop as TransformProperty;
    writes.set(part + ':' + prop, { target: { part, prop }, value: neutral(prop) });
  }
  const poses = definition.states[activity as keyof typeof definition.states] ?? definition.states.idle;
  for (const pose of poses) {
    const part = definition.roles[pose.role as keyof typeof definition.roles], prop = pose.prop as TransformProperty;
    const rest = neutral(prop), value = pose.value + ('outputGain' in pose ? Number(pose.outputGain) * Math.max(0, Math.min(1, output)) : 0);
    writes.set(part + ':' + prop, { target: { part, prop }, value: rest + (value - rest) * (mode === 'reduced' ? 0.08 : 1) });
  }
  return [...writes.values()];
}
