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
export function animatedPoint(cloud: ParticleCloud, index: number, elapsed: number): Vec3 {
  const part = cloud.parts[cloud.partIndices[index]], offset = index * 3;
  const point = Array.from(cloud.positions.subarray(offset, offset + 3)) as Vec3;
  if (!part?.motion) return point;
  const m = part.motion, wave = Math.sin(elapsed / m.periodMs * Math.PI * 2 + m.phase);
  const local = point.map((x, k) => x - m.pivot[k]) as Vec3;
  const rotated = rotatePoint(local, m.rotate.map(x => x * wave) as Vec3);
  return rotated.map((x, k) => x + m.pivot[k] + m.translate[k] * wave) as Vec3;
}
