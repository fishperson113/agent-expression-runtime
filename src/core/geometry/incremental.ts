import { spatialAssignment } from './assignment';
import type { Part, ParticleCloud } from './types';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => JSON.stringify(key) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
function signature(part: Part) {
  const { weight: _weight, color: _color, ...geometry } = part;
  return canonical(geometry);
}
export function retainedParts(previous: ParticleCloud, next: ParticleCloud) {
  const retained = next.parts.map(part => previous.parts.findIndex(old => old.id === part.id && signature(old) === signature(part)));
  for (const part of next.parts) if (part.trajectory) {
    const group = part.trajectory.group;
    const before = previous.parts.filter(p => p.trajectory?.group === group).map(p => p.id).sort();
    const members = next.parts.map((p, i) => p.trajectory?.group === group ? i : -1).filter(i => i >= 0);
    if (members.some(i => retained[i] < 0) || JSON.stringify(before) !== JSON.stringify(members.map(i => next.parts[i].id).sort()))
      for (const i of members) retained[i] = -1;
  }
  return retained;
}

export function incrementalAssignment(from: Float32Array, previous: ParticleCloud, oldMap: Uint32Array,
  next: ParticleCloud, retained: number[]) {
  const count = oldMap.length, map = new Uint32Array(count), fixed = new Uint8Array(count);
  const used = new Uint8Array(count), assigned = new Uint8Array(count);
  next.parts.forEach((part, group) => {
    const oldGroup = previous.parts.findIndex(p => p.id === part.id);
    if (oldGroup < 0) return;
    const sources = Array.from({ length: count }, (_, i) => i).filter(i => previous.partIndices[oldMap[i]] === oldGroup).sort((a, b) => oldMap[a] - oldMap[b]);
    const targets = Array.from({ length: count }, (_, i) => i).filter(i => next.partIndices[i] === group);
    const n = Math.min(sources.length, targets.length);
    for (let rank = 0; rank < n; rank++) {
      const source = sources[Math.floor(rank * sources.length / n)], target = targets[Math.floor(rank * targets.length / n)];
      map[source] = target; assigned[source] = 1; used[target] = 1;
      if (retained[group] < 0) continue;
      fixed[source] = 1;
      next.positions.set(previous.positions.subarray(oldMap[source] * 3, oldMap[source] * 3 + 3), target * 3);
    }
  });
  const sources = Array.from({ length: count }, (_, i) => i).filter(i => !assigned[i]);
  const targets = Array.from({ length: count }, (_, i) => i).filter(i => !used[i]);
  const gather = (points: Float32Array, indices: number[]) => Float32Array.from(indices.flatMap(i => [...points.subarray(i * 3, i * 3 + 3)]));
  const rest = spatialAssignment(gather(from, sources), gather(next.positions, targets));
  sources.forEach((source, i) => { map[source] = targets[rest[i]]; });
  return { map, fixed };
}
