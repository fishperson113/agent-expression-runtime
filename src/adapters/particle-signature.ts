export function particleSignature(positions: Float32Array, count: number, style: number[]) {
  let signature = 2166136261;
  const stride = Math.max(3, Math.floor(count / 64) * 3);
  for (let i = 0; i < count * 3; i += stride)
    for (let axis = 0; axis < 3; axis++)
      signature = Math.imul(signature ^ Math.round(positions[i + axis] * 10000), 16777619);
  for (const value of style) signature = Math.imul(signature ^ Math.round(value * 10000), 16777619);
  return signature >>> 0;
}
