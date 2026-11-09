import { finite, strictObject, eventKinds } from './observation';
import { liveSignals } from './signals';
import { channel, transformProperties, transformRange, type Pose, type LiveControl, type TransformTarget, type LiveConfiguration } from './control-types';

const identifier = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(value);
export function target(value: unknown): TransformTarget {
  const object = strictObject(value, ['part', 'prop']);
  if (!identifier(object.part) || !transformProperties.includes(object.prop)) throw Error('live_target');
  return object as TransformTarget;
}
export function pose(value: unknown): Pose {
  const optional = ['delayMs', 'attackMs', 'releaseMs'].filter(key => value && typeof value === 'object' && key in value);
  const object = strictObject(value, ['type', 'target', 'value', 'durationMs', ...optional]);
  if (object.type !== 'pose') throw Error('live_pose');
  const aim = target(object.target); finite(object.value, ...transformRange(aim.prop));
  finite(object.durationMs, 100, 10000);
  if (!Number.isInteger(object.durationMs)) throw Error('live_duration');
  for (const key of optional) { finite(object[key], key === 'delayMs' ? 0 : 20, 10000); if (!Number.isInteger(object[key])) throw Error('live_duration'); }
  if ((object.delayMs ?? 0) + object.durationMs > 10000 ||
    (object.attackMs ?? object.durationMs / 2) + (object.releaseMs ?? object.durationMs / 2) > object.durationMs) throw Error('live_pose_timing');
  return object as Pose;
}
function control(value: any): LiveControl {
  if (value?.type === 'bind') {
    strictObject(value, ['type', 'id', 'signal', 'target', 'gain', 'offset', 'clamp', 'smoothMs']);
    const aim = target(value.target), [min, max] = transformRange(aim.prop);
    if (!Object.hasOwn(liveSignals, value.signal) || !Array.isArray(value.clamp) || value.clamp.length !== 2) throw Error('live_signal');
    finite(value.gain, -4, 4); finite(value.offset, min, max);
    finite(value.clamp[0], min, max); finite(value.clamp[1], min, max);
    if (value.clamp[0] > value.clamp[1]) throw Error('live_clamp');
    finite(value.smoothMs, 40, 2000);
  } else if (value?.type === 'orient') {
    strictObject(value, ['type', 'id', 'part', 'toward', 'maxDeg', 'smoothMs']);
    strictObject(value.toward, ['entity']);
    if (!identifier(value.part) || value.toward.entity !== 'user') throw Error('live_entity');
    finite(value.maxDeg, 0, 30); finite(value.smoothMs, 40, 2000);
  } else if (value?.type === 'reflex') {
    strictObject(value, ['type', 'id', 'when', 'do', 'cooldownMs']); strictObject(value.when, ['event']);
    if (!eventKinds.includes(value.when.event)) throw Error('live_event');
    pose(value.do); finite(value.cooldownMs, 500, 300000);
  } else throw Error('live_control_type');
  if (!identifier(value.id)) throw Error('live_control_id');
  return value;
}
export function validateConfiguration(value: unknown): LiveConfiguration {
  const object = strictObject(value, ['controls', 'poses', 'lifetimeMs']);
  if (!Array.isArray(object.controls) || object.controls.length > 32 || !Array.isArray(object.poses) || object.poses.length > 16) throw Error('live_control_budget');
  finite(object.lifetimeMs, 1000, 300000);
  const controls = object.controls.map(control), poses: Pose[] = object.poses.map(pose), ids = new Set<string>();
  const writes = new Set<string>(); let bindings = 0, reflexes = 0;
  for (const item of controls) {
    if (ids.has(item.id)) throw Error('live_duplicate_id'); ids.add(item.id);
    if (item.type === 'reflex') { reflexes++; continue; }
    bindings++;
    const channels = item.type === 'bind' ? [channel(item.target)] : [item.part + ':rotateX', item.part + ':rotateY'];
    for (const key of channels) { if (writes.has(key)) throw Error('live_property_conflict'); writes.add(key); }
  }
  if (bindings > 16 || reflexes > 16) throw Error('live_control_budget');
  const owned = new Map<string, [number, number][]>();
  for (const item of poses) {
    const key = channel(item.target), start = item.delayMs ?? 0, end = start + item.durationMs;
    if (end > object.lifetimeMs) throw Error('live_pose_lease');
    const spans = owned.get(key) ?? [];
    if (spans.some(([a, b]) => start < b && end > a)) throw Error('live_property_conflict');
    spans.push([start, end]); owned.set(key, spans);
  }
  return structuredClone({ controls, poses, lifetimeMs: object.lifetimeMs });
}
