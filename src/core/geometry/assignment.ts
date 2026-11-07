function morton(x: number, y: number, z: number) {
  const coordinates = [x, y, z].map(v => Math.max(0, Math.min(1023, Math.round((v + 3) / 6 * 1023))));
  let result = 0;
  for (let bit = 0; bit < 10; bit++) for (let axis = 0; axis < 3; axis++)
    result |= ((coordinates[axis] >> bit) & 1) << (bit * 3 + axis);
  return result >>> 0;
}
export function spatialAssignment(from: Float32Array, to: Float32Array): Uint32Array {
  const count = from.length / 3;
  const order = (points: Float32Array) => Array.from({ length: count }, (_, i) => ({ i,
    key: morton(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]) })).sort((a, b) => a.key - b.key || a.i - b.i);
  const origins = order(from), targets = order(to), map = new Uint32Array(count);
  origins.forEach((source, rank) => { map[source.i] = targets[rank].i; });
  return map;
}
