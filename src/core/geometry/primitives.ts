import { capability } from '../../primitives/registry';

function shapePoints(u: number, v: number, w: number): Record<string, number[]> {
  const angle = u * Math.PI * 2, y = 1 - 2 * v, radius = Math.sqrt(1 - y * y);
  return {
    sphere: [radius * Math.cos(angle), y, radius * Math.sin(angle)],
    wall: [u * 2 - 1, y, (w - 0.5) * 0.04],
    wave: [u * 2 - 1, Math.sin(u * 8 + v * 4) * 0.22, v * 2 - 1],
    cloud: [(u * 2 - 1) * 0.9, y * 0.9, (w * 2 - 1) * 0.9],
    pin: [Math.cos(angle) * 0.06, y, Math.sin(angle) * 0.06],
    screw: [Math.cos(v * Math.PI * 6) * 0.45, y, Math.sin(v * Math.PI * 6) * 0.45],
    pyramid: [(u * 2 - 1) * v, y, (w * 2 - 1) * v],
  };
}
export function shapeBuffers(count: number, seed = 42) {
  let s = seed;
  const random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const shapes = capability.shapes.map(() => new Float32Array(count * 3));
  for (let i = 0; i < count; i++) {
    const points = shapePoints(random(), random(), random());
    capability.shapes.forEach((name, k) => {
      if (!points[name]) throw Error('shape_generator_missing:' + name);
      shapes[k].set(points[name], i * 3);
    });
  }
  return shapes;
}
