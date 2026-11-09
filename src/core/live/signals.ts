import type { Observation } from './types';

export const liveSignals = {
  'agent.output': [0, 1], 'user.head.yaw': [-90, 90], 'user.head.pitch': [-90, 90],
  'user.position.x': [-1, 1], 'user.position.y': [-1, 1],
  'hand.primary.position.x': [-1, 1], 'hand.primary.position.y': [-1, 1],
  'user.expression.smile': [0, 1], 'user.expression.browRaise': [0, 1],
  'user.expression.eyesClosed': [0, 1], 'user.expression.mouthOpen': [0, 1],
  'user.mouthMoving': [0, 1],
} as const;
export type LiveSignal = keyof typeof liveSignals;

export function signalValue(name: LiveSignal, snapshot: Observation | null, output = 0): number | null {
  if (name === 'agent.output') return Number.isFinite(output) ? Math.max(0, Math.min(1, output)) : 0;
  if (name === 'hand.primary.position.x' || name === 'hand.primary.position.y') return handPosition(name, snapshot);
  if (!snapshot || snapshot.camera !== 'tracking' || !snapshot.user.present) return null;
  const user = snapshot.user;
  if (name === 'user.mouthMoving') return typeof user.mouthMoving === 'boolean' ? Number(user.mouthMoving) : null;
  const [, group, field] = name.split('.') as ['user', 'head' | 'position' | 'expression', string];
  const value = user[group] as Record<string, number> | null;
  const coordinate = value?.[field], [min, max] = liveSignals[name];
  return typeof coordinate === 'number' && Number.isFinite(coordinate) ? Math.max(min, Math.min(max, coordinate)) : null;
}

function handPosition(name: 'hand.primary.position.x' | 'hand.primary.position.y', snapshot: Observation | null): number | null {
  const hands = snapshot?.hands;
  if (!snapshot || !['tracking', 'absent'].includes(snapshot.camera) || hands?.trackingState !== 'tracked' || !hands.primaryTrackId) return null;
  const hand = hands.entities.find(entity => entity.trackId === hands.primaryTrackId);
  const coordinate = hand?.landmarks[0]?.[name.endsWith('.x') ? 'x' : 'y'];
  return typeof coordinate === 'number' && Number.isFinite(coordinate) ? Math.max(-1, Math.min(1, 1 - 2 * coordinate)) : null;
}
