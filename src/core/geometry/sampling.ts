import { trajectoryMatrix } from './trajectory';
import type { Part, ParticleCloud, Sculpture, Vec3 } from './types';
import { curveTable, curvePoint } from './curves';

export function rotatePoint(point: Vec3, angles: Vec3): Vec3 {
  let [x, y, z] = point;
  let c = Math.cos(angles[0]), s = Math.sin(angles[0]); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(angles[1]); s = Math.sin(angles[1]); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(angles[2]); s = Math.sin(angles[2]); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}
function point(part: Part, u: number, v: number, table?: Vec3[]): Vec3 {
  if (part.kind === 'curve') return curvePoint(table!, u, v * Math.PI * 2, part.radius);
  if (part.kind === 'patch') {
    const [a, b, c, d] = part.points;
    return a.map((_, k) => (1 - v) * (a[k] * (1 - u) + b[k] * u) + v * (d[k] * (1 - u) + c[k] * u)) as Vec3;
  }
  const y = 1 - 2 * u, r = Math.sqrt(Math.max(0, 1 - y * y)), angle = v * Math.PI * 2;
  const p = rotatePoint([Math.cos(angle) * r * part.scale[0], y * part.scale[1], Math.sin(angle) * r * part.scale[2]], part.rotation ?? [0, 0, 0]);
  return p.map((x, k) => x + part.center[k]) as Vec3;
}
export function sculptureCloud(form: Sculpture, count: number): ParticleCloud {
  const parts = [...form.parts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const total = parts.reduce((sum, p) => sum + (p.weight ?? 1), 0);
  const positions = new Float32Array(count * 3), partIndices = new Uint8Array(count);
  let assigned = 0, cumulative = 0;
  parts.forEach((part, partIndex) => {
    cumulative += part.weight ?? 1;
    const end = partIndex === parts.length - 1 ? count : Math.floor(cumulative / total * count), n = end - assigned;
    const table = part.kind === 'curve' ? curveTable(part.points) : undefined;
    for (let i = 0; i < n; i++) {
      const v = (i * 0.61803398875 + 0.37) % 1;
      positions.set(point(part, (i + 0.5) / n, v, table), (assigned + i) * 3);
      partIndices[assigned + i] = partIndex;
    }
    assigned = end;
  });
  const topology = JSON.stringify(parts.map(p => [p.id, p.kind, p.weight ?? 1, p.kind === 'ellipsoid' ? 0 : p.points.length]));
  return { positions, partIndices, parts, topology };
}
export function motionTransforms(cloud: ParticleCloud, elapsed: number, trajectoryElapsed = elapsed) {
  const groups = new Map<string, Float64Array>();
  return cloud.parts.map(part => {
    if (part.trajectory) {
      const track = part.trajectory;
      if (!groups.has(track.group)) groups.set(track.group, trajectoryMatrix(track, trajectoryElapsed));
      return groups.get(track.group)!;
    }
    if (!part.motion) return null;
    const m = part.motion, wave = Math.sin(elapsed / m.periodMs * Math.PI * 2 + m.phase);
    const angles = m.rotate.map(x => x * wave) as Vec3;
    const [a, b, c] = [rotatePoint([1, 0, 0], angles), rotatePoint([0, 1, 0], angles), rotatePoint([0, 0, 1], angles)];
    const matrix = new Float64Array(12);
    for (let k = 0; k < 3; k++) {
      matrix.set([a[k], b[k], c[k], m.pivot[k] + m.translate[k] * wave -
        a[k] * m.pivot[0] - b[k] * m.pivot[1] - c[k] * m.pivot[2]], k * 4);
    }
    return matrix;
  });
}
export function animatedPoint(cloud: ParticleCloud, index: number, matrices: (Float64Array | null)[], out: Vec3) {
  const j = index * 3, [x, y, z] = [cloud.positions[j], cloud.positions[j + 1], cloud.positions[j + 2]];
  const m = matrices[cloud.partIndices[index]];
  if (!m) { out[0] = x; out[1] = y; out[2] = z; return; }
  for (let k = 0; k < 3; k++) out[k] = m[k * 4] * x + m[k * 4 + 1] * y + m[k * 4 + 2] * z + m[k * 4 + 3];
}
