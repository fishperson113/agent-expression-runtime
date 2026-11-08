import { unavailableUser, type Observation, type LiveTurn, type LiveEventKind, type Expressions } from '../core/live/types';

export type FaceSample = { landmarks: { x: number; y: number; z: number }[];
  scores: Record<string, number>; matrix: number[]; durationMs: number; delegate: string };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
type Cue = { type: LiveEventKind; at: number };

export class FaceObservations {
  snapshot: Observation;
  private previousAt?: number;
  private streak = 0;
  private mouthAt = -Infinity;
  private lastMouth = 0;
  private states = new Map<string, { value: boolean; candidate: boolean; since: number }>();
  private expressionHigh = false;
  constructor(sessionId: string) {
    this.snapshot = { v: 1, sessionId, seq: 0, capturedAt: Date.now(), camera: 'stopped',
      user: unavailableUser(), turn: 'idle', summary: 'Camera đang tắt.' };
  }
  private debounce(key: string, next: boolean, at: number, hold: number, events: Cue[], on: LiveEventKind, off: LiveEventKind) {
    const state = this.states.get(key) ?? { value: false, candidate: next, since: at };
    if (next !== state.candidate) { state.candidate = next; state.since = at; }
    if (next !== state.value && at - state.since >= hold) {
      state.value = next; events.push({ type: next ? on : off, at });
    }
    this.states.set(key, state);
  }
  status(camera: Observation['camera'], at: number) {
    this.streak = 0; this.previousAt = undefined; this.states.clear(); this.mouthAt = -Infinity;
    this.snapshot = { ...this.snapshot, seq: this.snapshot.seq + 1, capturedAt: at, camera,
      user: unavailableUser(), summary: camera === 'denied' ? 'Chưa có quyền camera; trạng thái người dùng chưa biết.' : 'Camera không quan sát; trạng thái người dùng chưa biết.' };
    return this.snapshot;
  }
  turn(turn: LiveTurn, at: number): Cue[] {
    if (turn === this.snapshot.turn) return [];
    this.snapshot = { ...this.snapshot, turn, seq: this.snapshot.seq + 1, capturedAt: at };
    return [{ type: 'turn_changed', at }];
  }
  private expressions(scores: Record<string, number>, alpha: number): Expressions {
    const raw = { smile: ((scores.mouthSmileLeft ?? 0) + (scores.mouthSmileRight ?? 0)) / 2,
      browRaise: scores.browInnerUp ?? 0, eyesClosed: ((scores.eyeBlinkLeft ?? 0) + (scores.eyeBlinkRight ?? 0)) / 2,
      mouthOpen: scores.jawOpen ?? 0 };
    const previous = this.snapshot.user.expression;
    for (const key of Object.keys(raw) as (keyof Expressions)[])
      raw[key] = clamp((previous?.[key] ?? raw[key]) + (raw[key] - (previous?.[key] ?? raw[key])) * alpha);
    return raw;
  }
  update(sample: FaceSample, at: number): Cue[] {
    const events: Cue[] = [], present = sample.landmarks.length >= 478;
    const dt = this.previousAt === undefined ? 100 : clamp(at - this.previousAt, 0, 200);
    this.previousAt = at; this.streak = present ? this.streak + 1 : 0;
    this.debounce('present', present, at, 1000, events, 'user_arrived', 'user_left');
    const user = present ? this.user(sample, dt, at) : unavailableUser();
    if (present && user.facingScreen !== null) {
      this.debounce('facing', !user.facingScreen, at, 700, events, 'looked_away', 'looked_back');
      this.debounce('mouth', !!user.mouthMoving, at, 180, events, 'mouth_started', 'mouth_stopped');
      const high = Object.values(user.expression!).some(value => value > (this.expressionHigh ? 0.4 : 0.6));
      const changes: Cue[] = [];
      this.debounce('expression', high, at, 300, changes, 'expression_changed', 'expression_changed');
      if (changes.length) { this.expressionHigh = high; events.push(...changes); }
    }
    this.snapshot = { ...this.snapshot, seq: this.snapshot.seq + 1, capturedAt: at,
      camera: present ? 'tracking' : 'absent', user, summary: this.summary(user) };
    return events;
  }
  private user(sample: FaceSample, dt: number, at: number): Observation['user'] {
    const m = sample.matrix, degrees = 180 / Math.PI, alpha = 1 - Math.exp(-dt / 100);
    const head = m.length >= 16 ? { yaw: clamp(Math.atan2(m[8], m[10]) * degrees, -90, 90),
      pitch: clamp(Math.asin(clamp(-m[9], -1, 1)) * degrees, -90, 90), roll: Math.atan2(m[1], m[5]) * degrees } : null;
    const expression = this.expressions(sample.scores, alpha), center = sample.landmarks[1];
    if (Math.abs(expression.mouthOpen - this.lastMouth) > 0.015) this.mouthAt = at;
    this.lastMouth = expression.mouthOpen;
    const threshold = this.snapshot.user.facingScreen ? 35 : 25;
    return { present: true, quality: { score: Math.min(1, this.streak / 15), basis: 'tracking-stability' },
      position: { x: clamp(1 - center.x * 2, -1, 1), y: clamp(1 - center.y * 2, -1, 1) }, head,
      facingScreen: head ? Math.abs(head.yaw) < threshold && Math.abs(head.pitch) < threshold : null,
      expression, mouthMoving: at - this.mouthAt < 250 };
  }
  private summary(user: Observation['user']) {
    if (!user.present) return 'Chưa thấy khuôn mặt trong khung hình.';
    const facing = user.facingScreen === null ? 'chưa rõ hướng đầu' : user.facingScreen ? 'đầu hướng gần camera' : 'đầu quay khỏi camera';
    return 'Có người trong khung hình, ' + facing + (user.expression!.smile > 0.5 ? ', nét cười rõ.' : '.') + ' Đây là ước lượng hình học.';
  }
}
