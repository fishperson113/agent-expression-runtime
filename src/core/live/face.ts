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
export function faceWrites(activity: string, output: number, mode: 'normal' | 'reduced' | 'off', at = 0, gaze = 0): TransformWrite[] {
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
  for (const write of livingFace(at, mode, gaze)) {
    const key = write.target.part + ':' + write.target.prop, base = writes.get(key);
    writes.set(key, base ? { ...write, value: base.value * write.value } : write);
  }
  for (const part of [definition.roles.leftEye, definition.roles.rightEye]) {
    const eye = writes.get(part + ':scaleY');
    if (eye) eye.value += Math.max(0, 1 - eye.value) * Math.max(0, Math.min(1, gaze));
  }
  return [...writes.values()];
}

function livingFace(at: number, mode: 'normal' | 'reduced', gaze: number): TransformWrite[] {
  const t = at / 1000, gain = mode === 'reduced' ? 0.08 : 1;
  const blinkPhase = ((t % 5.7) - 4.9) / 0.28;
  const blink = blinkPhase > 0 && blinkPhase < 1 ? Math.sin(blinkPhase * Math.PI) ** 2 : 0;
  const eyes = [definition.roles.leftEye, definition.roles.rightEye, 'pupil_left', 'pupil_right'];
  return [
    ...eyes.map(part => ({ target: { part, prop: 'scaleY' as const }, value: 1 - blink * 0.82 * gain * (1 - Math.max(0, Math.min(1, gaze))) })),
    { target: { part: 'fin', prop: 'rotateZ' }, value: Math.sin(t * 2.3) * 0.09 * gain },
    { target: { part: 'gill', prop: 'scaleX' }, value: 1 + Math.sin(t * 1.7) * 0.035 * gain },
    { target: { part: 'dorsal', prop: 'rotateZ' }, value: Math.sin(t * 1.4 + 0.7) * 0.035 * gain },
  ];
}

export function geometricGazeWrites(point: { x: number; y: number; strength: number } | null): TransformWrite[] {
  if (!point || ![point.x, point.y, point.strength].every(Number.isFinite)) return [];
  const strength = Math.max(0, Math.min(1, point.strength));
  return [definition.roles.leftPupil, definition.roles.rightPupil].flatMap(part => [
    { target: { part, prop: 'x' as const }, value: Math.max(-strength, Math.min(strength, point.x)) * 0.12 },
    { target: { part, prop: 'y' as const }, value: Math.max(-strength, Math.min(strength, point.y)) * 0.075 },
  ]);
}
