export type Vec3 = [number, number, number];
export type PartMotion = { pivot: Vec3; translate: Vec3; rotate: Vec3; periodMs: number; phase: number };
type PartBase = { id: string; weight?: number; motion?: PartMotion | null };
export type Part = PartBase & (
  | { kind: 'curve'; points: Vec3[]; radius: number }
  | { kind: 'ellipsoid'; center: Vec3; scale: Vec3; rotation?: Vec3 }
  | { kind: 'patch'; points: Vec3[] }
);
export type Sculpture = { parts: Part[] };
export type ParticleCloud = { positions: Float32Array; partIndices: Uint8Array; parts: Part[]; topology: string };
