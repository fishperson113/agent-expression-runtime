const eyes = [-0.32, 0.32].map((x, index) => ({ id: 'eye-' + index, kind: 'ellipsoid',
  center: [x, 0.25, 0], scale: [0.09, 0.14, 0.06] }));
export function attentionBody(assembled = false) {
  return { type: 'parallel', children: [
    ...(!assembled ? [{ type: 'assemble', durationMs: 280, parts: [...eyes,
      { id: 'mouth', kind: 'curve', points: [[-0.32, -0.25, 0], [0, -0.32, 0], [0.32, -0.25, 0]], radius: 0.045 },
      { id: 'outline', kind: 'curve', points: [[0, 0.85, 0], [0.8, 0, 0], [0, -0.85, 0], [-0.8, 0, 0], [0, 0.85, 0]], radius: 0.035 },
    ] }] : []),
    { type: 'shapeQuality', advance: 0.16, grow: 1.04, durationMs: 280 },
    { type: 'flow', field: 'pulse', strength: 0.05, durationMs: 280 },
  ] };
}
export class InteractionBody {
  lastAt = -Infinity; lastTick = -Infinity; lastCue = -Infinity; frozen = false; intensity = 0;
  constructor(engine, now = () => performance.now()) { this.engine = engine; this.now = now; }
  cue(type) {
    const now = this.now();
    if (type !== 'user_message' && now - this.lastCue < 1000) return;
    this.lastCue = now; this.lastAt = now; this.frozen = false; this.intensity = 0.5;
    if (type === 'user_message') {
      this.engine.express({ body: attentionBody(this.engine.state?.shape === 'assembled') }); return;
    }
    const rise = { task_success: 0.12, task_failure: -0.08, needs_user: 0.04 }[type] ?? 0;
    this.engine.express({ body: { type: 'parallel', children: [
      { type: 'shapeQuality', rise, advance: type === 'needs_user' ? 0.15 : 0, grow: 1, durationMs: 450 },
      { type: 'flow', field: 'pulse', strength: 0.04, durationMs: 450 },
    ] } });
  }
  react(reaction) { this.lastAt = this.now(); this.intensity = reaction.intensity; this.frozen = false; }
  tick(status) {
    const now = this.now();
    if (now - this.lastTick < 2000) return;
    this.lastTick = now;
    const idle = ['idle', 'done', 'unknown'].includes(status);
    const residual = this.intensity * Math.exp(-Math.max(0, now - this.lastAt) / 30000);
    if (idle && !this.frozen && now - this.lastAt > 30000) {
      this.engine.settle?.(); this.frozen = true;
      this.engine.express({ body: { type: 'flow', field: 'pulse', strength: 0.04, durationMs: 500 } });
    }
    this.engine.express({ kind: 'state', body: { brightness: (idle ? 0.65 : 0.78) + residual * 0.12,
      grow: 1 + (idle ? Math.sin(now / 2200) * 0.006 : 0), durationMs: 1000 } });
  }
}
