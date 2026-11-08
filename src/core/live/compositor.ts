import { signalValue } from './signals';
import { channel, neutral, type LiveConfiguration, type Pose, type TransformTarget } from './control-types';
import type { LiveEventKind, Observation } from './types';

export type TransformWrite = { target: TransformTarget; value: number; weight?: number };
export function composeWrites(layers: TransformWrite[][]): TransformWrite[] {
  const writes = new Map<string, TransformWrite>();
  for (const layer of layers) for (const write of layer) {
    const weight = Math.max(0, Math.min(1, write.weight ?? 1));
    if (weight < 0.001) continue;
    const key = channel(write.target), lower = writes.get(key)?.value ?? neutral(write.target.prop);
    writes.set(key, { target: write.target, value: lower + (write.value - lower) * weight });
  }
  return [...writes.values()];
}
type TimedPose = { pose: Pose; at: number };
export class LiveCompositor {
  private configuration?: LiveConfiguration;
  private installedAt = 0;
  private previous?: number;
  private writes = new Map<string, TransformWrite>();
  private cooldown = new Map<string, number>();
  private reflex?: TimedPose;
  private parts = new Set<string>();
  mode: 'normal' | 'reduced' | 'off' = 'normal';
  install(configuration: LiveConfiguration, at: number) {
    this.configuration = structuredClone(configuration); this.installedAt = at;
    this.cooldown.clear(); this.reflex = undefined;
  }
  reset() { this.configuration = undefined; this.writes.clear(); this.cooldown.clear(); this.reflex = undefined; }
  topology(ids: string[]) {
    this.parts = new Set(ids);
    for (const [key, write] of this.writes) if (write.target.part !== 'body' && !this.parts.has(write.target.part)) this.writes.delete(key);
    if (!this.configuration) return;
    const present = (part: string) => part === 'body' || this.parts.has(part);
    this.configuration.controls = this.configuration.controls.filter(item => present(item.type === 'bind' ? item.target.part : item.type === 'orient' ? item.part : item.do.target.part));
    this.configuration.poses = this.configuration.poses.filter(item => present(item.target.part));
    if (this.reflex && !present(this.reflex.pose.target.part)) this.reflex = undefined;
  }
  event(type: LiveEventKind, at: number) {
    if (!this.configuration || at - this.installedAt > this.configuration.lifetimeMs || this.mode === 'off') return;
    const rules = this.configuration.controls.filter(item => item.type === 'reflex');
    const rule = rules.find(item => item.when.event === type && at - (this.cooldown.get(item.id) ?? -Infinity) >= item.cooldownMs);
    if (!rule) return;
    this.cooldown.set(rule.id, at); this.reflex = { pose: rule.do, at };
  }
  private poseValue(timed: TimedPose, now: number) {
    const elapsed = (now - timed.at) / timed.pose.durationMs;
    if (elapsed < 0 || elapsed >= 1) return null;
    const rest = neutral(timed.pose.target.prop), envelope = Math.sin(elapsed * Math.PI) ** 2;
    return rest + (timed.pose.value - rest) * envelope;
  }
  sample(now: number, snapshot: Observation | null, output: number, blocked = new Set<string>()): TransformWrite[] {
    const dt = this.previous === undefined ? 16 : Math.max(0, Math.min(100, now - this.previous)); this.previous = now;
    if (this.mode === 'off') return [...this.writes.values()];
    const desired = new Map<string, { target: TransformTarget; value: number; smoothMs: number }>();
    const put = (target: TransformTarget, value: number, smoothMs = 100) => desired.set(channel(target), { target, value, smoothMs });
    if (this.configuration && now - this.installedAt <= this.configuration.lifetimeMs) {
      if (this.reflex) { const value = this.poseValue(this.reflex, now); if (value !== null) put(this.reflex.pose.target, value); }
      this.bindings(snapshot, output, put);
      for (const pose of this.configuration.poses) {
        const value = this.poseValue({ pose, at: this.installedAt }, now); if (value !== null) put(pose.target, value, 40);
      }
    }
    const active = new Set(desired.keys());
    for (const [key, write] of this.writes) if (!desired.has(key)) put(write.target, neutral(write.target.prop), 160);
    for (const [key, aim] of desired) {
      const rest = neutral(aim.target.prop), write: TransformWrite = this.writes.get(key) ?? { target: aim.target, value: rest };
      const value = blocked.has(key) ? rest : aim.value;
      write.value += (rest + (value - rest) * (this.mode === 'reduced' ? 0.08 : 1) - write.value) * (1 - Math.exp(-dt / aim.smoothMs));
      const weight = active.has(key) && !blocked.has(key) ? 1 : 0;
      write.weight = (write.weight ?? 0) + (weight - (write.weight ?? 0)) * (1 - Math.exp(-dt / 160));
      if (!active.has(key) && write.weight < 0.001) { this.writes.delete(key); continue; }
      this.writes.set(key, write);
    }
    return [...this.writes.values()];
  }
  private bindings(snapshot: Observation | null, output: number, put: (target: TransformTarget, value: number, smoothMs?: number) => unknown) {
    for (const item of this.configuration?.controls ?? []) {
      if (item.type === 'bind') {
        const value = signalValue(item.signal, snapshot, output);
        put(item.target, value === null ? neutral(item.target.prop) : Math.max(item.clamp[0], Math.min(item.clamp[1], item.offset + item.gain * value)), item.smoothMs);
      }
      if (item.type === 'orient') {
        const position = snapshot?.camera === 'tracking' ? snapshot.user.position : null, max = item.maxDeg * Math.PI / 180;
        put({ part: item.part, prop: 'rotateY' }, (position?.x ?? 0) * max, item.smoothMs);
        put({ part: item.part, prop: 'rotateX' }, -(position?.y ?? 0) * max, item.smoothMs);
      }
    }
  }
}
