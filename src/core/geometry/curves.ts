import type { Vec3 } from './types';

function catmull(points: Vec3[], u: number): Vec3 {
  const position = u * (points.length - 1), i = Math.min(points.length - 2, Math.floor(position)), t = position - i;
  const [a, b, c, d] = [points[Math.max(0, i - 1)], points[i], points[i + 1], points[Math.min(points.length - 1, i + 2)]];
  return [0, 1, 2].map(k => 0.5 * (2 * b[k] + (-a[k] + c[k]) * t +
    (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t * t * t)) as Vec3;
}
export function curveTable(points: Vec3[]): Vec3[] {
  const raw = Array.from({ length: 129 }, (_, i) => catmull(points, i / 128));
  const lengths = [0];
  for (let i = 1; i < raw.length; i++) lengths.push(lengths[i - 1] + Math.hypot(...raw[i].map((x, k) => x - raw[i - 1][k])));
  let segment = 0;
  return raw.map((_, i) => {
    const distance = lengths[128] * i / 128;
    while (segment < 127 && lengths[segment + 1] < distance) segment++;
    const t = (distance - lengths[segment]) / (lengths[segment + 1] - lengths[segment] || 1);
    return raw[segment].map((x, k) => x + (raw[segment + 1][k] - x) * t) as Vec3;
  });
}
export function curvePoint(table: Vec3[], u: number, angle: number, radius: number): Vec3 {
  const position = u * 128, i = Math.min(127, Math.floor(position)), t = position - i;
  const a = table[i], b = table[i + 1], delta = b.map((x, k) => x - a[k]);
  const length = Math.hypot(...delta) || 1, [tx, ty, tz] = delta.map(x => x / length);
  const divisor = Math.hypot(tx, ty);
  const n = divisor > 1e-8 ? [-ty / divisor, tx / divisor, 0] : [1, 0, 0];
  const binormal = [ty * n[2] - tz * n[1], tz * n[0] - tx * n[2], tx * n[1] - ty * n[0]];
  return a.map((x, k) => x + (b[k] - x) * t + radius * (n[k] * Math.cos(angle) + binormal[k] * Math.sin(angle))) as Vec3;
}
