import { capability } from '../../primitives/registry';
import type { ParticleCloud, Sculpture, Vec3 } from './types';
import { shapeBuffers } from './primitives';
import { sculptureCloud, animatedPoint, motionTransforms, rotatePoint } from './sampling';
import { spatialAssignment } from './assignment';
import type { PerformancePart } from '../runtime/presence';

function performanceMatrix(part: PerformancePart) {
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => rotatePoint(axis as Vec3, part.rotate));
  const matrix = new Float64Array(12);
  for (let k = 0; k < 3; k++) {
    matrix.set([axes[0][k], axes[1][k], axes[2][k], part.pivot[k] + part.translate[k] -
      axes[0][k] * part.pivot[0] - axes[1][k] * part.pivot[1] - axes[2][k] * part.pivot[2]], k * 4);
  }
  return matrix;
}

export class ParticleFormation {
  points?: Float32Array;
  private operation?: object;
  private from?: Float32Array;
  private cloud?: ParticleCloud;
  private mapping?: Uint32Array;
  private topology = '';
  private motionAt = 0;
  private motionElapsed = 0;
  private motionSpeed = 1;
  private quietAt?: number;
  motionMode = 'normal';
  quiet = false;
  private progress = 1;
  private sampledAt = NaN;
  private primitives?: Float32Array[];
  readonly groups: Uint8Array;
  private performed?: Float32Array;
  private displayed?: Float32Array;
  constructor(readonly count = capability.assembly.particles) { this.groups = new Uint8Array(count); }
  get parts() { return this.cloud?.parts ?? []; }
  private origin(weights: number[], seed: number) {
    this.primitives ??= shapeBuffers(this.count, seed);
    const points = new Float32Array(this.count * 3);
    for (let i = 0; i < points.length; i++)
      for (let k = 0; k < weights.length; k++) points[i] += this.primitives[k][i] * weights[k];
    return points;
  }
  sample(operation: object, target: string | Sculpture, t: number, weights: number[], seed: number, now: number) {
    if (typeof target === 'string' && !this.points) return;
    if (this.operation !== operation) {
      this.tick(now);
      this.points ??= this.origin(weights, seed);
      this.from = (this.displayed ?? this.points).slice();
      this.primitives ??= shapeBuffers(this.count, seed);
      const cloud = typeof target === 'string'
        ? { positions: this.primitives[capability.shapes.indexOf(target)], parts: [], partIndices: new Uint8Array(this.count), topology: 'primitive:' + target }
        : sculptureCloud(target, this.count);
      if (cloud.topology !== this.topology) this.mapping = spatialAssignment(this.from, cloud.positions);
      for (let i = 0; i < this.count; i++) this.groups[i] = cloud.partIndices[this.mapping![i]] ?? 0;
      this.cloud = cloud; this.topology = cloud.topology; this.operation = operation;
      this.motionAt = now; this.motionElapsed = 0; this.motionSpeed = 1;
    }
    this.progress = t;
    this.sampledAt = NaN; this.tick(now);
  }
  tick(now: number) {
    if (!this.points || !this.cloud || !this.from || !this.mapping) return;
    if (this.sampledAt === now) return;
    this.sampledAt = now;
    const dt = Math.max(0, now - this.motionAt); this.motionAt = now;
    const speed = this.motionMode === 'off' ? 0 : this.motionMode === 'reduced' ? 0.08 : 1;
    if (!this.quiet) this.quietAt = undefined;
    else this.quietAt ??= now;
    const targetSpeed = this.quietAt !== undefined && now - this.quietAt > 30000 ? 0 : speed;
    this.motionSpeed += (targetSpeed - this.motionSpeed) * (1 - Math.exp(-dt / 2000));
    this.motionElapsed += dt * (this.motionMode === 'off' ? 0 : this.motionSpeed);
    const matrices = motionTransforms(this.cloud, this.motionElapsed), target: Vec3 = [0, 0, 0];
    for (let i = 0; i < this.count; i++) {
      animatedPoint(this.cloud, this.mapping[i], matrices, target); const j = i * 3;
      for (let k = 0; k < 3; k++) this.points[j + k] = this.from[j + k] + (target[k] - this.from[j + k]) * this.progress;
    }
  }
  freeze(now: number) {
    if (!this.points) return;
    this.tick(now);
    const positions = (this.displayed ?? this.points).slice();
    this.cloud = { positions, parts: [], partIndices: new Uint8Array(this.count), topology: 'frozen' };
    this.from = positions; this.mapping = Uint32Array.from({ length: this.count }, (_, i) => i);
    this.operation = undefined; this.topology = 'frozen'; this.progress = 1;
    this.groups.fill(0);
  }
  perform(parts: PerformancePart[]) {
    if (!this.points || !this.cloud || !parts.length) return this.displayed = this.points;
    this.performed ??= new Float32Array(this.points.length);
    this.performed.set(this.points);
    const bindings = parts.map(part => ({ part, group: this.cloud!.parts.findIndex(p => p.id === part.partId),
      matrix: performanceMatrix(part) }));
    for (const { part, group, matrix } of bindings) {
      if (group < 0 || !matrix) continue;
      for (let i = 0; i < this.count; i++) if (this.groups[i] === group) {
        const j = i * 3, x = (this.points[j] - part.pivot[0]) * part.scale[0] + part.pivot[0];
        const y = (this.points[j + 1] - part.pivot[1]) * part.scale[1] + part.pivot[1];
        const z = (this.points[j + 2] - part.pivot[2]) * part.scale[2] + part.pivot[2];
        for (let k = 0; k < 3; k++) this.performed[j + k] = matrix[k * 4] * x + matrix[k * 4 + 1] * y + matrix[k * 4 + 2] * z + matrix[k * 4 + 3];
      }
    }
    return this.displayed = this.performed;
  }
}
