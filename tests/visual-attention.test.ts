import { expect, it } from 'vitest';
import { VisualAttention } from '../src/core/live/visual-attention';
import { unavailableUser, type Observation } from '../src/core/live/types';
function fixture() {
  let at = 0, seq = 0;
  const attention = new VisualAttention({ now: () => at, wallNow: () => 10000 + at });
  const observation = (x = 0.2, track = 'hand_1', capturedAt = 10000 + at): Observation => ({ v: 1,
    sessionId: 'source', seq: ++seq, capturedAt, camera: 'absent', user: unavailableUser(), turn: 'working', summary: '',
    hands: { v: 1, trackingState: 'tracked', coordinateSpace: 'image-normalized', landmarkSchema: 'mediapipe-hand-21',
      zMeaning: 'wrist-relative-image-width', mirrored: false, sourceWidth: 640, sourceHeight: 480, primaryTrackId: track,
      entities: [{ detectionId: 0, trackId: track, handedness: 'Unknown', confidence: 0.9,
        landmarks: Array.from({ length: 21 }, () => ({ x, y: 0.4, z: 0 })) }] } });
  return { attention, observation, time: (value: number) => { at = value; },
    sample: (blocked = false, mode: 'normal' | 'reduced' | 'off' = 'normal', activity = 'working') => attention.sample('e', activity, blocked, mode) };
}
function replay() {
  const f = fixture(), output = []; f.attention.reset('e');
  for (let t = 0; t < 20000; t += 20) {
    f.time(t); if (t % 40 === 0) f.attention.observe(f.observation(t < 10000 ? 0.2 : 0.8));
    output.push(f.sample());
  }
  return { output, trace: f.attention.snapshot() };
}
it('replays identical bounded glance trajectories and does not backlog continuous or still observations', () => {
  const a = replay(); expect(a).toEqual(replay());
  expect(a.trace.history.filter(e => e.status === 'started')).toHaveLength(2);
  expect(a.output.every(p => !p || [p.x, p.y].every(n => Number.isFinite(n) && Math.abs(n) <= 1))).toBe(true);
  expect(a.trace.history.every(e => e.epoch === 'e' && e.sourceSeq >= e.evidenceStartSeq && e.evidenceStartSeq > 0)).toBe(true);
});
it('requires distinct measurements, retains compatible tracks, and revokes lost, stale or replaced targets', () => {
  const f = fixture(); f.attention.reset('e'); f.attention.observe(f.observation()); f.sample();
  f.time(100); f.attention.observe(f.observation(0.2, 'hand_1', 10000)); f.sample();
  expect(f.attention.snapshot().active).toBeNull();
  f.time(120); f.attention.observe(f.observation()); f.sample(); expect(f.attention.snapshot().active).not.toBeNull();
  f.time(140); f.attention.observe(f.observation(0.25)); expect(f.sample()).not.toBeNull();
  f.time(160); f.attention.observe(f.observation(0.3, 'hand_2')); f.sample(); expect(f.attention.snapshot().active).toBeNull();
  f.time(900); expect(f.sample()).toBeNull(); expect(f.attention.snapshot().reason).toBe('lost_or_stale');
});
it('cancels on intent, ownership, epoch and motion-off without reviving a cached measurement', () => {
  for (const stop of ['intent', 'owned', 'epoch', 'off']) {
    const f = fixture(); f.attention.reset('e'); f.attention.observe(f.observation()); f.sample();
    f.time(100); const latest = f.observation(); f.attention.observe(latest); f.sample();
    expect(f.attention.snapshot().active).not.toBeNull();
    if (stop === 'intent') f.attention.revoke();
    if (stop === 'owned') f.sample(true);
    if (stop === 'epoch') { f.attention.reset('e', latest); f.attention.observe(latest); }
    if (stop === 'off') f.sample(false, 'off');
    f.time(120); expect(f.sample()).toBeNull(); expect(f.attention.snapshot().active).toBeNull();
  }
});
it('ignores out-of-order frames and bounds history in a 20-minute virtual replay', () => {
  const f = fixture(); f.attention.reset('e'); const first = f.observation();
  for (let t = 0; t < 1200000; t += 100) {
    f.time(t); f.attention.observe(f.observation(Math.floor(t / 10000) % 2 ? 0.2 : 0.8));
    f.attention.observe(first); const p = f.sample(); expect(!p || Number.isFinite(p.x + p.y)).toBe(true);
  }
  expect(f.attention.snapshot().history.length).toBeLessThanOrEqual(32);
});
it('uses briefer working episodes and bounded reduced motion without changing cue meaning', () => {
  const busy = fixture(), idle = fixture();
  for (const f of [busy, idle]) { f.attention.reset('e'); f.attention.observe(f.observation()); f.sample(); f.time(100); f.attention.observe(f.observation()); }
  busy.sample(false, 'normal', 'working'); idle.sample(false, 'normal', 'idle');
  expect(busy.attention.snapshot().active!.expiresAt).toBe(950);
  expect(idle.attention.snapshot().active!.expiresAt).toBe(1200);
  busy.time(250); const normal = busy.sample()!;
  const reduced = busy.sample(false, 'reduced')!; expect(reduced.x).toBeCloseTo(normal.x * 0.08);
  busy.time(951); expect(busy.sample()).toBeNull();
});
it('fails closed on clock rewind until an explicit epoch reset', () => {
  const f = fixture(); f.attention.reset('e'); f.attention.observe(f.observation()); f.sample();
  f.time(100); f.attention.observe(f.observation()); f.sample(); expect(f.attention.snapshot().active).not.toBeNull();
  f.time(50); expect(f.sample()).toBeNull();
  f.time(200); f.attention.observe(f.observation()); expect(f.sample()).toBeNull();
  expect(f.attention.snapshot().reason).toBe('clock_discontinuity');
  expect(f.attention.snapshot().history.every(e => Number.isFinite(e.at))).toBe(true);
  f.time(300); f.attention.reset('new'); f.attention.observe(f.observation()); f.attention.sample('new', 'working', false, 'normal');
  f.time(400); f.attention.observe(f.observation()); f.attention.sample('new', 'working', false, 'normal');
  expect(f.attention.snapshot().active).not.toBeNull();
});
it('ignores handedness confidence and permits a moving same-track target after distinct-measurement debounce', () => {
  const outputs = [];
  for (const confidence of [0.01, 0.99]) {
    const f = fixture(); f.attention.reset('e');
    const observe = (x: number) => { const value = f.observation(x); value.hands!.entities[0].confidence = confidence; f.attention.observe(value); };
    observe(0.2); f.sample(); f.time(100); observe(0.8); f.sample();
    expect(f.attention.snapshot().active).not.toBeNull(); f.time(200); outputs.push(f.sample());
  }
  expect(outputs[0]).toEqual(outputs[1]);
});
it('does not replay a motion opportunity that occurred entirely during cooldown', () => {
  const f = fixture(); f.attention.reset('e');
  for (let t = 0; t <= 8000; t += 100) {
    f.time(t); f.attention.observe(f.observation(t < 2000 ? 0.2 : 0.8)); f.sample();
  }
  expect(f.attention.snapshot().history.filter(e => e.status === 'started')).toHaveLength(1);
});
