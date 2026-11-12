const cellSize = 0.12, maxChecks = 32, maxNeighbours = 8, maxSpeed = 3.5;
const offsets = Array.from({ length: 27 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) % 3 - 1, Math.floor(i / 9) - 1])
  .sort((a, b) => a.reduce((s, x) => s + x * x, 0) - b.reduce((s, x) => s + x * x, 0));
const hash = (x: number, y: number, z: number) => Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);

export class TargetBoids {
  private positions = new Float32Array(0);
  private velocities = new Float32Array(0);
  private targets = new Float32Array(0);
  private previous = new Float32Array(0);
  private targetVelocity = new Float32Array(0);
  private forces = new Float32Array(0);
  private next = new Int32Array(0);
  private heads = new Map<number, number>();
  private count = 0;
  private lastTime?: number;
  private checks = 0;
  private error = 0;
  private enabled = true;
  private resize(target: Float32Array, count: number) {
    if (count === this.count) return;
    const old = this.count * 3, length = count * 3;
    for (const key of ['positions', 'velocities', 'targets', 'previous', 'targetVelocity', 'forces'] as const) {
      const buffer = new Float32Array(length); buffer.set(this[key].subarray(0, length)); this[key] = buffer;
    }
    if (length > old) {
      this.positions.set(target.subarray(old, length), old);
      this.previous.set(target.subarray(old, length), old);
    }
    this.next = new Int32Array(count); this.count = count;
  }
  private grid() {
    this.heads.clear();
    for (let i = 0; i < this.count; i++) {
      const j = i * 3, key = hash(Math.floor(this.positions[j] / cellSize), Math.floor(this.positions[j + 1] / cellSize), Math.floor(this.positions[j + 2] / cellSize));
      this.next[i] = this.heads.get(key) ?? -1; this.heads.set(key, i);
    }
  }
  private flock(i: number, groups?: Uint8Array) {
    const j = i * 3, p = this.positions, t = this.targets, v = this.velocities, tv = this.targetVelocity;
    const x = Math.floor(p[j] / cellSize), y = Math.floor(p[j + 1] / cellSize), z = Math.floor(p[j + 2] / cellSize);
    let checks = 0, neighbours = 0, ax = 0, ay = 0, az = 0;
    for (const offset of offsets) {
      let other = this.heads.get(hash(x + offset[0], y + offset[1], z + offset[2])) ?? -1;
      while (other >= 0 && checks < maxChecks && neighbours < maxNeighbours) {
        const k = other * 3, next = this.next[other]; checks++;
        const dx = p[j] - p[k], dy = p[j + 1] - p[k + 1], dz = p[j + 2] - p[k + 2], d2 = dx * dx + dy * dy + dz * dz;
        if (other !== i && (groups?.[i] ?? 0) === (groups?.[other] ?? 0) && d2 < cellSize * cellSize) {
          const targetDistance = (t[j] - t[k]) ** 2 + (t[j + 1] - t[k + 1]) ** 2 + (t[j + 2] - t[k + 2]) ** 2;
          const separation = d2 > 1e-8 && d2 < targetDistance * 0.64 ? 0.2 / Math.sqrt(d2) : 0;
          ax += dx * separation + (p[k] - t[k] - p[j] + t[j]) * 12 + (v[k] - tv[k] - v[j] + tv[j]) * 2;
          ay += dy * separation + (p[k + 1] - t[k + 1] - p[j + 1] + t[j + 1]) * 12 + (v[k + 1] - tv[k + 1] - v[j + 1] + tv[j + 1]) * 2;
          az += dz * separation + (p[k + 2] - t[k + 2] - p[j + 2] + t[j + 2]) * 12 + (v[k + 2] - tv[k + 2] - v[j + 2] + tv[j + 2]) * 2;
          neighbours++;
        }
        other = next;
      }
      if (checks >= maxChecks || neighbours >= maxNeighbours) break;
    }
    this.checks += checks;
    const gain = Math.min(1, Math.hypot(p[j] - t[j], p[j + 1] - t[j + 1], p[j + 2] - t[j + 2]) / 0.15) / Math.max(1, neighbours);
    this.forces[j] = ax * gain; this.forces[j + 1] = ay * gain; this.forces[j + 2] = az * gain;
  }
  private integrate(i: number, dt: number, steps: number) {
    const j = i * 3, p = this.positions, v = this.velocities, t = this.targets, tv = this.targetVelocity;
    for (let step = 0; step < steps; step++) {
      for (let k = j; k < j + 3; k++) v[k] += ((t[k] - p[k]) * 100 + (tv[k] - v[k]) * 20 + this.forces[k]) * dt;
      const speed = Math.hypot(v[j], v[j + 1], v[j + 2]), scale = Math.min(1, maxSpeed / (speed || 1));
      for (let k = j; k < j + 3; k++) { v[k] *= scale; p[k] += v[k] * dt; }
    }
    const error = Math.hypot(p[j] - t[j], p[j + 1] - t[j + 1], p[j + 2] - t[j + 2]);
    if (error < 0.003 && Math.hypot(tv[j], tv[j + 1], tv[j + 2]) < 0.02) {
      for (let k = j; k < j + 3; k++) { p[k] = t[k]; v[k] = tv[k]; }
    }
    this.error += error;
  }
  apply(output: Float32Array, count: number, now: number, groups?: Uint8Array, enabled = true, rigid?: Uint8Array) {
    this.resize(output, count); this.enabled = enabled; this.checks = 0; this.error = 0;
    this.targets.set(output.subarray(0, count * 3));
    const first = this.lastTime === undefined;
    const elapsed = first ? 0 : Math.max(0, (now - this.lastTime!) / 1000);
    this.lastTime = now;
    if (!enabled || first) {
      this.positions.set(this.targets); this.previous.set(this.targets); this.velocities.fill(0); return;
    }
    for (let i = 0; i < count; i++) if (rigid?.[i]) {
      for (let k = i * 3; k < i * 3 + 3; k++) {
        this.positions[k] = this.targets[k]; this.previous[k] = this.targets[k];
        this.velocities[k] = 0; this.targetVelocity[k] = 0; this.forces[k] = 0;
      }
    }
    if (elapsed === 0) { output.set(this.positions); return; }
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      for (let k = j; k < j + 3; k++) this.targetVelocity[k] = (this.targets[k] - this.previous[k]) / elapsed;
      const speed = Math.hypot(this.targetVelocity[j], this.targetVelocity[j + 1], this.targetVelocity[j + 2]);
      if (speed > maxSpeed) for (let k = j; k < j + 3; k++) this.targetVelocity[k] *= maxSpeed / speed;
    }
    this.grid(); for (let i = 0; i < count; i++) if (!rigid?.[i]) this.flock(i, groups);
    const duration = Math.min(0.1, elapsed), steps = Math.max(1, Math.ceil(duration * 60));
    for (let i = 0; i < count; i++) if (!rigid?.[i]) this.integrate(i, duration / steps, steps);
    output.set(this.positions); this.previous.set(this.targets);
  }
  get info() { return { mode: this.enabled ? 'target-boids' : 'off', particles: this.count,
    neighbourChecks: this.checks, maxChecksPerParticle: maxChecks, meanTargetError: this.error / Math.max(1, this.count) }; }
}
