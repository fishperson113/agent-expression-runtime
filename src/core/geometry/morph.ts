import { capability } from '../../primitives/registry';
import type { ParticleCloud, Sculpture, Vec3 } from './types';
import { shapeBuffers } from './primitives';
import { sculptureCloud, animatedPoint, motionTransforms, rotatePoint } from './sampling';
import { spatialAssignment } from './assignment';
import { canonical, incrementalAssignment, retainedParts } from './incremental';
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
  private retained = new Uint8Array(0);
  private partMotion: number[] = [];
  private partTrajectory: number[] = [];
  private continuing: boolean[] = [];
  private motionAt = 0;
  private trajectoryReady = false;
  private motionSpeed = 1;
  private quietAt?: number;
  motionMode = 'normal';
  quiet = false;
  private progress = 1;
  private sampledAt = NaN;
  private primitives?: Float32Array[];
  readonly groups: Uint8Array;
  colors?: Float32Array;
  private fromColors?: Float32Array;
  private targetColors?: Float32Array;
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
      this.prepareAssignment(cloud);
      for (let i = 0; i < this.count; i++) this.groups[i] = cloud.partIndices[this.mapping![i]] ?? 0;
      this.prepareColors(cloud);
      this.cloud = cloud; this.topology = cloud.topology; this.operation = operation;
      this.motionAt = now;
      if (!this.continuing.some(Boolean)) this.motionSpeed = 1;
      this.trajectoryReady = false;
    }
    this.progress = t;
    if (this.colors && this.fromColors && this.targetColors) for (let i = 0; i < this.colors.length; i++)
      this.colors[i] = this.fromColors[i] + (this.targetColors[i] - this.fromColors[i]) * t;
    this.sampledAt = NaN; this.tick(now);
  }
  private prepareAssignment(cloud: ParticleCloud) {
    const previous = this.cloud;
    const retained = previous && this.progress >= 1 && canonical(previous.parts) !== canonical(cloud.parts) ? retainedParts(previous, cloud) : cloud.parts.map(() => -1);
    this.retained = new Uint8Array(this.count);
    if (previous?.parts.length && cloud.parts.length && this.mapping) {
      const result = incrementalAssignment(this.from!, previous, this.mapping, cloud, retained);
      this.mapping = result.map; this.retained = result.fixed;
    } else if (cloud.topology !== this.topology) this.mapping = spatialAssignment(this.from!, cloud.positions);
    this.partMotion = retained.map(index => index < 0 ? 0 : this.partMotion[index]);
    this.partTrajectory = retained.map(index => index < 0 ? 0 : this.partTrajectory[index]);
    this.continuing = retained.map(index => index >= 0);
  }
  private prepareColors(cloud: ParticleCloud) {
    if (!this.colors && !cloud.parts.some(part => part.color !== undefined)) return;
    this.colors ??= new Float32Array(this.count * 4);
    this.fromColors = this.colors.slice(); this.targetColors = new Float32Array(this.count * 4);
    const palette = cloud.parts.map(part => {
      if (!part.color) return [0, 0, 0, 0];
      const rgb = [1, 3, 5].map(offset => parseInt(part.color!.slice(offset, offset + 2), 16) / 255);
      return [...rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), 1];
    });
    for (let i = 0; i < this.count; i++) this.targetColors.set(palette[this.groups[i]] ?? [0, 0, 0, 0], i * 4);
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
    const trajectoryReady = this.trajectoryReady;
    if (this.progress >= 1) this.trajectoryReady = true;
    for (let i = 0; i < this.partMotion.length; i++) {
      this.partMotion[i] += dt * (this.motionMode === 'off' ? 0 : this.motionSpeed);
      if ((this.continuing[i] || trajectoryReady) && this.motionMode !== 'off') this.partTrajectory[i] += dt;
    }
    const matrices = motionTransforms(this.cloud, this.partMotion, this.partTrajectory), target: Vec3 = [0, 0, 0];
    for (let i = 0; i < this.count; i++) {
      animatedPoint(this.cloud, this.mapping[i], matrices, target); const j = i * 3;
      for (let k = 0; k < 3; k++) this.points[j + k] = this.from[j + k] + (target[k] - this.from[j + k]) * (this.retained[i] ? 1 : this.progress);
    }
  }
  freeze(now: number) {
    if (!this.points) return;
    this.tick(now);
    const positions = (this.displayed ?? this.points).slice();
    this.cloud = { positions, parts: [], partIndices: new Uint8Array(this.count), topology: 'frozen' };
    this.from = positions; this.mapping = Uint32Array.from({ length: this.count }, (_, i) => i);
    this.operation = undefined; this.topology = 'frozen'; this.progress = 1;
    this.groups.fill(0); this.retained.fill(0);
    this.partMotion = []; this.partTrajectory = []; this.continuing = [];
  }
  perform(parts: PerformancePart[]) {
    if (!this.points || !this.cloud || !parts.length) return this.displayed = this.points;
    this.performed ??= new Float32Array(this.points.length);
    this.performed.set(this.points);
    const bindings = parts.map(part => ({ part, group: this.cloud!.parts.findIndex(p => p.id === part.partId),
      matrix: performanceMatrix(part) }));
    for (const { part, group, matrix } of bindings) {
      if (group < 0 || !matrix || this.cloud.parts[group].trajectory) continue;
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
