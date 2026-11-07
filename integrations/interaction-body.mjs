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
  scores = new WeakMap();
  remember(value) {
    const score = validatePerformance(value.performance, value.body);
    if (value.body && typeof value.body === 'object') this.scores.set(value.body, score);
  }
  setPerformance(score) {
    this.score = score;
    if (this.engine.state) this.engine.state.presenceIntent = { ...this.engine.state.presenceIntent,
      activity: this.engine.state.presenceIntent?.activity ?? 'unknown', performance: score };
  }
  presence(status) {
    if (!this.engine.state) return;
    const previous = this.engine.state.presenceIntent;
    this.engine.state.presenceIntent = { ...previous, activity: status ?? 'unknown',
      mood: this.mood ?? 'neutral', intensity: this.intensity * Math.exp(-Math.max(0, this.now() - this.lastAt) / 30000),
      performance: this.score ?? null,
      mode: previous?.mode ?? (['off', 'reduced'].includes(process.env.FISCH_MOTION) ? process.env.FISCH_MOTION : 'normal') };
  }
  cue(type) {
    const now = this.now();
    if (['interrupted', 'needs_user'].includes(type)) this.setPerformance(null);
    if (type !== 'user_message' && now - this.lastCue < 1000) return;
    this.lastCue = now; this.lastAt = now; this.frozen = false; this.intensity = 0.5;
    if (type === 'user_message') {
      this.setPerformance(null);
      this.attendingUntil = now + 45000;
      this.engine.express({ kind: 'state', body: { advance: 0.16, grow: 1.04, durationMs: 280 } });
      this.engine.express({ body: attentionBody(this.engine.state?.shape === 'assembled') }); return;
    }
    if (now < (this.attendingUntil ?? 0) && type !== 'needs_user' && type !== 'interrupted') return;
    const rise = { task_success: 0.12, task_failure: -0.08, needs_user: 0.04 }[type] ?? 0;
    this.engine.express({ body: { type: 'parallel', children: [
      { type: 'shapeQuality', rise, advance: type === 'needs_user' ? 0.15 : 0, grow: 1, durationMs: 450 },
      { type: 'flow', field: 'pulse', strength: 0.04, durationMs: 450 },
    ] } });
  }
  releaseAttention() {
    if (!this.attendingUntil) return;
    this.attendingUntil = 0;
    this.engine.express({ kind: 'state', body: { advance: 0, grow: 1, durationMs: 350 } });
  }
  react(reaction, geometry) {
    this.releaseAttention(); this.lastAt = this.now(); this.intensity = reaction.intensity; this.frozen = false;
    this.mood = reaction.mood;
    this.setPerformance(geometry ? this.scores.get(geometry) ?? null : null);
  }
  tick(status) {
    const now = this.now();
    this.presence(status);
    if (this.attendingUntil && now >= this.attendingUntil) this.releaseAttention();
    if (now - this.lastTick < 2000) return;
    this.lastTick = now;
    const idle = ['idle', 'done', 'unknown'].includes(status);
    const residual = this.intensity * Math.exp(-Math.max(0, now - this.lastAt) / 30000);
    const attending = now < (this.attendingUntil ?? 0);
    this.engine.express({ kind: 'state', body: { brightness: (idle ? 0.65 : 0.78) + residual * 0.12,
      grow: attending ? 1.04 : 1, durationMs: 1000 } });
  }
}
import { validatePerformance } from './expression-plan.mjs';
