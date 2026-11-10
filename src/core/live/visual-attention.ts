import type { Observation } from './types';
import { signalValue } from './signals';
type Point = { key: string; x: number; y: number; seq: number; measurement: number; until: number };
type Episode = { id: number; point: Point; start: number; duration: number; evidenceStartSeq: number };
type Entry = { episode: number; epoch: string; intent: number; sourceSeq: number; evidenceStartSeq: number; target: string; at: number; status: string; reason: string };
const clamp = (n: number) => Math.max(-1, Math.min(1, n));
export class VisualAttention {
  private epoch = 'idle'; private session?: string; private seq = -1; private measurement = -1;
  private processed = -1; private current?: Point; private anchor?: Point;
  private candidate?: { key: string; at: number; samples: number; fromSeq: number };
  private episode?: Episode; private serial = 0; private intent = 0; private cooldown = 0;
  private barrier?: Pick<Observation, 'sessionId' | 'seq' | 'capturedAt'>;
  private clockBroken = false;
  private previous = -Infinity; private reason = 'no_source'; private history: Entry[] = [];
  constructor(private clock: { now(): number; wallNow(): number }) {}
  private finish(reason: string, now: number) {
    if (this.episode) {
      const e = this.episode; this.record(e, 'ended', reason, now); this.episode = undefined;
    }
    this.candidate = undefined; this.reason = reason;
  }
  private record(e: Episode, status: string, reason: string, now: number) {
    this.history.push({ episode: e.id, epoch: this.epoch, intent: this.intent, sourceSeq: e.point.seq, evidenceStartSeq: e.evidenceStartSeq,
      target: e.point.key, at: Math.max(Number.isFinite(now) ? now : 0, Number.isFinite(this.previous) ? this.previous : 0), status, reason });
    if (this.history.length > 32) this.history.shift();
  }
  reset(epoch: string, barrier?: Pick<Observation, 'sessionId' | 'seq' | 'capturedAt'>) {
    this.finish('epoch_changed', this.clock.now()); this.epoch = epoch; this.session = undefined;
    this.barrier = barrier ? { sessionId: barrier.sessionId, seq: barrier.seq, capturedAt: barrier.capturedAt } : undefined;
    this.seq = -1; this.measurement = -1; this.processed = -1; this.current = undefined;
    this.anchor = undefined; this.cooldown = 0; this.previous = -Infinity; this.clockBroken = false;
  }
  rebase(reason: string) {
    this.finish(reason, this.clock.now()); this.anchor = this.current; this.processed = this.measurement;
  }
  revoke(reason = 'user_intent') { this.rebase(reason); this.intent++; }
  unavailable(reason = 'unavailable') {
    this.finish(reason, this.clock.now()); this.current = undefined; this.anchor = undefined;
  }
  observe(value: Observation) {
    const now = this.clock.now(), age = this.clock.wallNow() - value.capturedAt;
    if (this.clockBroken) return;
    if (!Number.isFinite(now) || now < this.previous) { this.unavailable('clock_discontinuity'); this.clockBroken = true; return; }
    if (this.barrier?.sessionId === value.sessionId && (value.seq <= this.barrier.seq || value.capturedAt === this.barrier.capturedAt)) return;
    if (!Number.isSafeInteger(value.seq) || value.seq <= this.seq || (this.session && value.sessionId !== this.session)) return;
    this.session = value.sessionId; this.seq = value.seq;
    const point = this.point(value);
    if (!point || !Number.isFinite(age) || age < 0 || age > 700) { this.unavailable('lost_or_stale'); return; }
    this.current = { ...point, seq: value.seq, measurement: value.capturedAt, until: now + 700 - age };
    this.measurement = value.capturedAt;
    if (this.episode && this.episode.point.key !== point.key) this.finish('target_changed', now);
  }
  private point(value: Observation): Pick<Point, 'key' | 'x' | 'y'> | undefined {
    const hand = value.hands?.entities.find(e => e.trackId === value.hands?.primaryTrackId);
    const x = signalValue('hand.primary.position.x', value), y = signalValue('hand.primary.position.y', value);
    if (hand && x !== null && y !== null) return { key: 'hand:' + hand.trackId, x, y };
    const p = value.camera === 'tracking' && value.user.present && value.user.quality.basis === 'tracking-stability' && value.user.quality.score >= 0.5 ? value.user.position : null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { key: 'face-position', x: clamp(p.x), y: clamp(p.y) };
  }
  sample(epoch: string, activity: string, blocked: boolean, mode: 'normal' | 'reduced' | 'off') {
    const now = this.clock.now();
    if (epoch !== this.epoch) { this.reset(epoch); return null; }
    if (this.clockBroken) return null;
    if (!Number.isFinite(now) || now < this.previous) { this.unavailable('clock_discontinuity'); this.clockBroken = true; return null; }
    this.previous = now;
    if (blocked || mode === 'off') {
      this.rebase(mode === 'off' ? 'motion_off' : 'owned'); return null;
    }
    const point = this.current;
    if (!point || now > point.until) { this.unavailable('lost_or_stale'); return null; }
    if (this.episode && now - this.episode.start >= this.episode.duration) this.finish('lease_elapsed', now);
    if (this.processed !== point.measurement) {
      this.processed = point.measurement;
      this.consider(point, now, activity);
    }
    const e = this.episode;
    if (!e) return null;
    e.point = point; this.anchor = point;
    const elapsed = now - e.start, envelope = Math.max(0, Math.min(1, elapsed / 120, (e.duration - elapsed) / 200));
    const weight = envelope * envelope * (3 - 2 * envelope) * (mode === 'reduced' ? 0.08 : 1);
    return { x: clamp(point.x) * weight, y: clamp(point.y) * weight, strength: weight };
  }
  private consider(point: Point, now: number, activity: string) {
    if (this.episode || now < this.cooldown) { this.anchor = point; this.candidate = undefined; return; }
    if ((!this.anchor || this.anchor.key !== point.key) && Math.hypot(point.x, point.y) < 0.08) {
      this.anchor = point; this.candidate = undefined; this.reason = 'centered'; return;
    }
    const novel = !this.anchor || this.anchor.key !== point.key || Math.hypot(point.x - this.anchor.x, point.y - this.anchor.y) >= 0.12;
    if (!novel) { this.candidate = undefined; this.reason = 'quiet'; return; }
    if (!this.candidate || this.candidate.key !== point.key) this.candidate = { key: point.key, at: now, samples: 0, fromSeq: point.seq };
    this.candidate.samples++;
    if (this.candidate.samples < 2 || now - this.candidate.at < 80) { this.reason = 'debouncing'; return; }
    this.episode = { id: ++this.serial, point, start: now, evidenceStartSeq: this.candidate.fromSeq, duration: ['working', 'replying'].includes(activity) ? 850 : 1100 };
    this.cooldown = now + 6000; this.anchor = point; this.candidate = undefined; this.reason = 'geometric_novelty';
    this.record(this.episode, 'started', this.reason, now);
  }
  snapshot() {
    return { active: this.episode ? { episode: this.episode.id, target: this.episode.point.key, sourceSeq: this.episode.point.seq,
      expiresAt: this.episode.start + this.episode.duration } : null, reason: this.reason, intent: this.intent,
      history: this.history.map(entry => ({ ...entry })), interpretation: 'Geometric attention, not semantic understanding or emotion.' };
  }
}
