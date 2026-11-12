import type { PartTrajectory, Vec3 } from './types';

export function trajectoryMatrix(track: PartTrajectory, elapsed: number) {
  const frames = track.keyframes;
  const end = frames.findIndex(frame => frame.atMs >= elapsed);
  const b = frames[end < 0 ? frames.length - 1 : end];
  const a = frames[Math.max(0, end < 0 ? frames.length - 1 : end - 1)];
  let t = a === b ? 0 : Math.max(0, Math.min(1, (elapsed - a.atMs) / (b.atMs - a.atMs)));
  if (b.easing === 'smoothstep') t = t * t * (3 - 2 * t);
  const angles = a.rotate.map((v, k) => {
    const delta = Math.atan2(Math.sin(b.rotate[k] - v), Math.cos(b.rotate[k] - v));
    return v + delta * t;
  }) as Vec3;
  const [x, y, z] = angles, cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const matrix = new Float64Array([
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, 0,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, 0,
    -sy, cy * sx, cy * cx, 0,
  ]);
  for (let k = 0; k < 3; k++) matrix[k * 4 + 3] = track.pivot[k] +
    a.translate[k] + (b.translate[k] - a.translate[k]) * t -
    matrix[k * 4] * track.pivot[0] - matrix[k * 4 + 1] * track.pivot[1] - matrix[k * 4 + 2] * track.pivot[2];
  return matrix;
}
