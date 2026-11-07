const motion = { pivot: [0, -0.7, 0], translate: [0, 0.03, 0], rotate: [0, 0, 0.06], periodMs: 4000, phase: 0 };
const curve = (id, points, radius = 0.06, weight = 1) => ({ id, kind: 'curve', points, radius, weight, motion });
export function peaceParts() {
  return [
    { id: 'palm', kind: 'ellipsoid', center: [0, -0.28, 0], scale: [0.34, 0.39, 0.09], rotation: [0, 0, -0.08], weight: 2.4, motion },
    curve('index', [[-0.16, -0.03, 0], [-0.25, 0.5, 0], [-0.38, 1.12, 0], [-0.36, 1.2, 0]], 0.075, 1.7),
    curve('middle', [[0.08, 0, 0], [0.29, 0.57, 0], [0.46, 1.12, 0], [0.45, 1.2, 0]], 0.075, 1.7),
    curve('ring', [[0.24, 0.02, 0.1], [0.33, -0.1, 0.14], [0.17, -0.2, 0.16], [0.1, -0.08, 0.1]], 0.065, 0.8),
    curve('pinky', [[0.28, -0.18, 0.08], [0.36, -0.3, 0.13], [0.22, -0.39, 0.16], [0.12, -0.28, 0.1]], 0.06, 0.8),
    curve('thumb', [[-0.31, -0.35, 0.12], [-0.13, -0.49, 0.21], [0.16, -0.32, 0.19]], 0.08, 1.2),
    { id: 'wrist', kind: 'patch', points: [[-0.2, -0.53, 0], [0.17, -0.53, 0], [0.15, -0.94, 0], [-0.21, -0.94, 0]], weight: 1, motion },
  ];
}
export function birdParts() {
  const flap = phase => ({ pivot: [0, 0, 0], translate: [0, 0.07, 0], rotate: [0, 0.45, 0.12], periodMs: 2500, phase });
  return [
    { id: 'body', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.16, 0.42, 0.1], weight: 1.2, motion: null },
    { id: 'head', kind: 'ellipsoid', center: [0, 0.5, 0], scale: [0.18, 0.18, 0.1], weight: 0.6, motion: null },
    { id: 'leftWing', kind: 'patch', points: [[-0.1, 0.25, 0], [-1.2, 0.6, 0], [-0.85, -0.25, 0], [-0.15, -0.2, 0]], weight: 2.5, motion: flap(0) },
    { id: 'rightWing', kind: 'patch', points: [[0.1, 0.25, 0], [1.2, 0.6, 0], [0.85, -0.25, 0], [0.15, -0.2, 0]], weight: 2.5, motion: flap(Math.PI) },
    { id: 'tail', kind: 'patch', points: [[-0.1, -0.25, 0], [0.1, -0.25, 0], [0.35, -0.9, 0], [-0.35, -0.9, 0]], weight: 1, motion: null },
    { ...curve('beak', [[0.05, 0.53, 0.08], [0.28, 0.5, 0.08]], 0.035, 0.3), motion: null },
  ];
}
export function sculptureProgram(parts, durationMs = 1200) {
  return { type: 'parallel', children: [
    { type: 'assemble', parts, durationMs },
    { type: 'flow', field: 'pulse', strength: 0.04, durationMs },
    { type: 'style', pointSize: 1.2, dispersion: 0, brightness: 0.85, durationMs },
  ] };
}
