function variedMotion(body, iteration) {
  const result = structuredClone(body), shift = (iteration * 0.61803398875 % 1) * Math.PI * 2;
  const tempo = iteration ? 0.92 + (iteration * 0.41421356237 % 1) * 0.16 : 1;
  for (const step of result.children) for (const node of step.children) {
    if (node.type !== 'assemble') continue;
    for (const part of node.parts) if (part.motion) {
      part.motion.phase = (part.motion.phase + shift) % (Math.PI * 2);
      part.motion.periodMs = Math.max(1000, Math.min(10000, part.motion.periodMs * tempo));
    }
  }
  return result;
}

export class IdleScenes {
  constructor(engine, now = () => performance.now(), onScore = () => {}) {
    Object.assign(this, { engine, now, onScore }); this.scenes = []; this.count = 0;
  }
  install(body, score, scenes) {
    this.base = { body, score, flow: this.engine.state?.flow, strength: this.engine.state?.flowStrength }; this.scenes = scenes;
    this.active = null; this.idleAt = undefined; this.nextAt = 0; this.caption = null; this.failed = new Set();
    this.lastPlayed = new Map();
  }
  restore() {
    if (!this.active || !this.base) return;
    try {
      const hasFlow = this.base.body.children?.some(step => step.children?.some(node => node.type === 'flow'));
      const body = !hasFlow && this.base.flow ? { type: 'parallel', children: [this.base.body,
        { type: 'flow', field: this.base.flow, strength: this.base.strength, durationMs: 350 }] } : this.base.body;
      const result = this.engine.express({ body });
      if (result.status !== 'accepted') throw Error('restore_rejected');
      this.onScore(this.base.score);
    } catch { this.error = 'restore_failed'; }
    this.active = null; this.caption = null;
  }
  clear(restore = true) {
    if (restore) this.restore();
    this.scenes = []; this.active = null; this.caption = null; this.idleAt = undefined;
  }
  tick(status) {
    const now = this.now();
    if (!['idle', 'done'].includes(status)) {
      this.restore(); this.idleAt = undefined; this.nextAt = 0; return;
    }
    this.idleAt ??= now;
    if (!this.scenes.length || now < this.nextAt || this.engine.state?.presenceIntent?.mode === 'off') return;
    const elapsed = now - this.idleAt;
    const candidates = this.scenes.filter(scene => scene.afterMs <= elapsed && !this.failed.has(scene.id));
    const choices = candidates.filter(scene => scene.id !== this.active?.id);
    if (!choices.length) return;
    const scene = choices.reduce((oldest, item) => (this.lastPlayed.get(item.id) ?? -Infinity) <
      (this.lastPlayed.get(oldest.id) ?? -Infinity) ? item : oldest);
    this.nextAt = now + 22000 + (this.count * 7919 % 11000);
    try {
      const result = this.engine.express({ body: variedMotion(scene.body, this.count) });
      if (result.status !== 'accepted') throw Error('scene_rejected');
      this.active = scene; this.caption = scene.caption ?? null; this.count++;
      this.lastPlayed.set(scene.id, now);
      this.onScore(null);
    } catch { this.failed.add(scene.id); }
  }
  get info() {
    return { available: this.scenes.length, active: this.active?.id, played: this.count,
      caption: this.caption, failed: this.failed?.size ?? 0, error: this.error, inference: false };
  }
}
