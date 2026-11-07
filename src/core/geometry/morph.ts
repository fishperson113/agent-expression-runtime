import { capability } from '../../primitives/registry';
import type { ParticleCloud, Sculpture } from './types';
import { shapeBuffers } from './primitives';
import { sculptureCloud, animatedPoint } from './sampling';
import { spatialAssignment } from './assignment';

export class ParticleFormation {
  points?: Float32Array;
  private operation?: object;
  private from?: Float32Array;
  private cloud?: ParticleCloud;
  private mapping?: Uint32Array;
  private topology = '';
  private start = 0;
  private progress = 1;
  private sampledAt = NaN;
  private primitives?: Float32Array[];
  constructor(readonly count = capability.assembly.particles) {}
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
      this.from = this.points.slice();
      this.primitives ??= shapeBuffers(this.count, seed);
      const cloud = typeof target === 'string'
        ? { positions: this.primitives[capability.shapes.indexOf(target)], parts: [], partIndices: new Uint8Array(this.count), topology: 'primitive:' + target }
        : sculptureCloud(target, this.count);
      if (cloud.topology !== this.topology) this.mapping = spatialAssignment(this.from, cloud.positions);
      this.cloud = cloud; this.topology = cloud.topology; this.start = now; this.operation = operation;
    }
    this.progress = t;
    this.sampledAt = NaN; this.tick(now);
  }
  tick(now: number) {
    if (!this.points || !this.cloud || !this.from || !this.mapping) return;
    if (this.sampledAt === now) return;
    this.sampledAt = now;
    for (let i = 0; i < this.count; i++) {
      const target = animatedPoint(this.cloud, this.mapping[i], now - this.start), j = i * 3;
      for (let k = 0; k < 3; k++) this.points[j + k] = this.from[j + k] + (target[k] - this.from[j + k]) * this.progress;
    }
  }
}
