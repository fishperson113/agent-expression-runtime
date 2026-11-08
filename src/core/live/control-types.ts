import type { Compiled } from '../runtime/ir';
import type { LiveSignal } from './signals';
import type { LiveEventKind } from './types';

export const transformProperties = ['x', 'y', 'z', 'rotateX', 'rotateY', 'rotateZ', 'scaleX', 'scaleY', 'scaleZ'] as const;
export type TransformProperty = typeof transformProperties[number];
export type TransformTarget = { part: string; prop: TransformProperty };
export type Binding = { type: 'bind'; id: string; signal: LiveSignal; target: TransformTarget;
  gain: number; offset: number; clamp: [number, number]; smoothMs: number };
export type Orient = { type: 'orient'; id: string; part: string; toward: { entity: 'user' }; maxDeg: number; smoothMs: number };
export type Pose = { type: 'pose'; target: TransformTarget; value: number; durationMs: number };
export type Reflex = { type: 'reflex'; id: string; when: { event: LiveEventKind }; do: Pose;
  cooldownMs: number };
export type LiveControl = Binding | Orient | Reflex;
export type LiveConfiguration = { controls: LiveControl[]; poses: Pose[]; lifetimeMs: number };
export type LiveCompiled = { program: Compiled; configuration?: LiveConfiguration };
export const channel = (target: TransformTarget) => target.part + ':' + target.prop;
export const neutral = (prop: TransformProperty) => prop.startsWith('scale') ? 1 : 0;
export const transformRange = (prop: TransformProperty): [number, number] =>
  prop.startsWith('scale') ? [0.25, 2] : prop.startsWith('rotate') ? [-0.6, 0.6] : [-0.4, 0.4];
