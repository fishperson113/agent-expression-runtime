import type { Part, Vec3 } from '../geometry/types';
import { rotatePoint } from '../geometry/sampling';
import type { TransformWrite } from './compositor';

export type LiveMatrix = Float64Array;
function pivot(part?: Part): Vec3 {
  if (!part) return [0, 0, 0];
  if (part.kind === 'ellipsoid') return part.center;
  return [0, 1, 2].map(axis => part.points.reduce((sum, point) => sum + point[axis], 0) / part.points.length) as Vec3;
}
export function transformMatrices(writes: TransformWrite[], parts: Part[]): (LiveMatrix | undefined)[] {
  const ids = ['body', ...parts.map(part => part.id)], grouped = new Map<string, Record<string, number>>();
  for (const write of writes) {
    const values = grouped.get(write.target.part) ?? {};
    values[write.target.prop] = write.value; grouped.set(write.target.part, values);
  }
  return ids.map((id, index) => {
    if (index > 0 && id === 'body') return undefined;
    const values = grouped.get(id); if (!values) return undefined;
    const center = pivot(parts[index - 1]), rotation = [values.rotateX ?? 0, values.rotateY ?? 0, values.rotateZ ?? 0] as Vec3;
    const scales = [values.scaleX ?? 1, values.scaleY ?? 1, values.scaleZ ?? 1];
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((axis, i) => rotatePoint(axis.map(value => value * scales[i]) as Vec3, rotation));
    const matrix = new Float64Array(12);
    for (let k = 0; k < 3; k++) matrix.set([axes[0][k], axes[1][k], axes[2][k],
      center[k] + (values[['x', 'y', 'z'][k]] ?? 0) - axes[0][k] * center[0] - axes[1][k] * center[1] - axes[2][k] * center[2]], k * 4);
    return matrix;
  });
}
export function livePoint(x: number, y: number, z: number, matrix: LiveMatrix | undefined, out: Vec3 = [0, 0, 0]): Vec3 {
  if (!matrix) { out[0] = x; out[1] = y; out[2] = z; return out; }
  for (let k = 0; k < 3; k++) out[k] = matrix[k * 4] * x + matrix[k * 4 + 1] * y + matrix[k * 4 + 2] * z + matrix[k * 4 + 3];
  return out;
}
