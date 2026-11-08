import type { Observation } from './types';

export const liveSignals = {
  'agent.output': [0, 1], 'user.head.yaw': [-90, 90], 'user.head.pitch': [-90, 90],
  'user.position.x': [-1, 1], 'user.position.y': [-1, 1],
  'user.expression.smile': [0, 1], 'user.expression.browRaise': [0, 1],
  'user.expression.eyesClosed': [0, 1], 'user.expression.mouthOpen': [0, 1],
  'user.mouthMoving': [0, 1],
} as const;
export type LiveSignal = keyof typeof liveSignals;

export function signalValue(name: LiveSignal, snapshot: Observation | null, output = 0): number | null {
  if (name === 'agent.output') return Number.isFinite(output) ? Math.max(0, Math.min(1, output)) : 0;
  if (!snapshot || snapshot.camera !== 'tracking' || !snapshot.user.present) return null;
  const user = snapshot.user;
  if (name === 'user.mouthMoving') return user.mouthMoving === null ? null : Number(user.mouthMoving);
  const [, group, field] = name.split('.') as ['user', 'head' | 'position' | 'expression', string];
  const value = user[group] as Record<string, number> | null;
  return value?.[field] ?? null;
}
