type Vec3 = [number, number, number];
export type PerformancePart = { partId: string; pivot: Vec3; translate: Vec3; rotate: Vec3; scale: Vec3 };
type Beat = { durationMs: number; parts: PerformancePart[] };
type Clip = { id: string; activity: string; gapMs: number; beats: Beat[] };
export type PerformanceScore = { clips: Clip[] };
export type PresenceIntent = {
  activity: string;
  mood?: string;
  intensity?: number;
  mode?: 'normal' | 'reduced' | 'off';
  performance?: PerformanceScore | null;
};
export type PresencePose = {
  x: number; y: number; roll: number; yaw: number; scale: number;
  energy: number; mode: string; suppressed: boolean; updatedAt: number;
  parts: PerformancePart[]; clipId?: string; clipCount: number;
};
export type PresenceState = BodyState & { presenceIntent?: PresenceIntent; presencePose?: PresencePose };

export class PresenceMotion {
  readonly pose: PresencePose = { x: 0, y: 0, roll: 0, yaw: 0, scale: 1,
    energy: 0, mode: 'normal', suppressed: false, updatedAt: 0, parts: [], clipCount: 0 };
  private previous?: number;
  private phase: number;
  private energy = 0;
  private score?: PerformanceScore | null;
  private clip?: Clip;
  private clipAt = 0;
  private wait = 0;
  private lastClip = '';
  private activity = '';
  private randomState = 42;
  constructor(seed = 42) {
    this.phase = (Math.imul(seed, 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
    this.randomState = seed >>> 0;
  }
  sample(now: number, intent: PresenceIntent, suppressed = false) {
    const dt = this.previous === undefined ? 0 : Math.max(0, Math.min(100, now - this.previous)) / 1000;
    this.previous = now;
    if (intent.mode === 'off') {
      Object.assign(this.pose, { mode: 'off', energy: 0, suppressed: true, updatedAt: now });
      return this.pose;
    }
    this.phase += dt;
    this.performance(dt * 1000, intent, suppressed);
    const idle = ['idle', 'done', 'unknown'].includes(intent.activity);
    const style = intent.mood === 'playful' || intent.mood === 'celebratory' ? 1.2 : 0.85;
    const intensity = Number.isFinite(intent.intensity) ? Math.max(0, Math.min(1, intent.intensity!)) : 0;
    const target = (idle ? 0.8 : 0.35) * style * (1 + intensity * 0.2);
    this.energy += (target - this.energy) * (1 - Math.exp(-dt / 0.8));
    const mode = intent.mode ?? 'normal', gain = mode === 'reduced' ? 0.12 : 1;
    const amplitude = this.energy * gain * (suppressed ? 0 : 1), t = this.phase;
    const blend = 1 - Math.exp(-dt / 0.35);
    const targets = { x: Math.sin(t * 0.41) * 0.025 * amplitude,
      y: Math.sin(t * 1.31) * 0.014 * amplitude,
      roll: (Math.sin(t * 0.59) + Math.sin(t * 0.23) * 0.3) * 0.028 * amplitude,
      yaw: Math.sin(t * 0.37) * 0.045 * amplitude,
      scale: 1 + Math.sin(t * 1.31) * 0.012 * amplitude };
    for (const key of ['x', 'y', 'roll', 'yaw', 'scale'] as const)
      this.pose[key] += (targets[key] - this.pose[key]) * blend;
    Object.assign(this.pose, { energy: this.energy * gain, mode, suppressed, updatedAt: now });
    return this.pose;
  }
  private random() {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }
  private recover(dt: number) {
    const gain = Math.exp(-dt / 180);
    for (const part of this.pose.parts) for (let k = 0; k < 3; k++) {
      part.translate[k] *= gain; part.rotate[k] *= gain;
      part.scale[k] = 1 + (part.scale[k] - 1) * gain;
    }
  }
  private begin(clip: Clip) {
    this.clip = clip; this.clipAt = 0; this.pose.clipId = clip.id; this.pose.clipCount++;
    const bindings = new Map(clip.beats.flatMap(beat => beat.parts).map(part => [part.partId, part]));
    this.pose.parts = [...bindings.values()].map(part => ({ partId: part.partId, pivot: [...part.pivot],
      translate: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] }));
  }
  private interpolate(from: Beat | undefined, to: Beat | undefined, t: number, gain: number) {
    const eased = t * t * (3 - 2 * t);
    for (const out of this.pose.parts) {
      const a = from?.parts.find(part => part.partId === out.partId), b = to?.parts.find(part => part.partId === out.partId);
      for (const key of ['translate', 'rotate', 'scale'] as const) for (let k = 0; k < 3; k++) {
        const rest = key === 'scale' ? 1 : 0;
        const start = a?.[key][k] ?? rest, end = b?.[key][k] ?? rest;
        out[key][k] = rest + (start + (end - start) * eased - rest) * gain;
      }
    }
  }
  private performance(dt: number, intent: PresenceIntent, suppressed: boolean) {
    if (this.score !== intent.performance) {
      this.score = intent.performance; this.clip = undefined; this.wait = 0; this.lastClip = '';
      this.pose.parts = []; this.pose.clipId = undefined;
    }
    const activity = ['idle', 'done', 'unknown'].includes(intent.activity) ? 'idle' : intent.activity;
    if (activity !== this.activity) {
      this.activity = activity; this.clip = undefined; this.wait = 300;
      this.pose.clipId = undefined; this.recover(dt); return;
    }
    if (suppressed || !this.score || this.clip && this.clip.activity !== activity) {
      this.clip = undefined; this.pose.clipId = undefined; this.recover(dt); return;
    }
    if (!this.clip) {
      this.recover(dt); this.wait -= dt;
      if (this.wait > 0) return;
      const eligible = this.score.clips.filter(clip => clip.activity === activity);
      const choices = eligible.length > 1 ? eligible.filter(clip => clip.id !== this.lastClip) : eligible;
      if (!choices.length) return;
      this.begin(choices[Math.floor(this.random() * choices.length)]);
      this.clipSpeed = 0.9 + this.random() * 0.2;
    }
    const clip = this.clip!; this.clipAt += dt * this.clipSpeed;
    let elapsed = this.clipAt, previous: Beat | undefined;
    for (const beat of clip.beats) {
      if (elapsed < beat.durationMs) {
        this.interpolate(previous, beat, elapsed / beat.durationMs, intent.mode === 'reduced' ? 0.12 : 1); return;
      }
      elapsed -= beat.durationMs; previous = beat;
    }
    this.interpolate(previous, undefined, Math.min(1, elapsed / 450), intent.mode === 'reduced' ? 0.12 : 1);
    if (elapsed >= 450) {
      this.lastClip = clip.id;
      this.wait = Math.min(clip.gapMs * (0.9 + this.random() * 0.2), activity === 'working' ? 6000 : 15000);
      this.clip = undefined; this.pose.clipId = undefined;
    }
  }
  private clipSpeed = 1;
}
import type { BodyState } from '../ports';

