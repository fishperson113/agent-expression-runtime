import { unavailableUser, type Observation, type LiveEvent, type LiveEventKind, type ObservationRead } from './types';

export const eventKinds: LiveEventKind[] = ['user_arrived', 'user_left', 'looked_away', 'looked_back',
  'expression_changed', 'mouth_started', 'mouth_stopped', 'turn_changed'];
export function strictObject(value: unknown, fields: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('live_object');
  const object = value as Record<string, any>;
  if (Object.keys(object).some(key => !fields.includes(key)) || fields.some(key => !(key in object))) throw Error('live_fields');
  return object;
}
export function finite(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error('live_range');
  return value;
}
function nullableVector(value: unknown, fields: string[], min: number, max: number) {
  if (value === null) return;
  const vector = strictObject(value, fields);
  for (const key of fields) finite(vector[key], min, max);
}
export function validateObservation(value: unknown): Observation {
  const object = strictObject(value, ['v', 'sessionId', 'seq', 'capturedAt', 'camera', 'user', 'turn', 'summary']);
  if (object.v !== 1 || typeof object.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(object.sessionId)) throw Error('live_version_session');
  finite(object.seq, 0, Number.MAX_SAFE_INTEGER); finite(object.capturedAt, 0, Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(object.seq) || !['starting', 'tracking', 'absent', 'denied', 'error', 'stopped', 'stale'].includes(object.camera)) throw Error('live_camera');
  if (!['idle', 'working', 'waiting', 'interrupted'].includes(object.turn)) throw Error('live_turn');
  if (typeof object.summary !== 'string' || object.summary.length > 400 || /[\x00-\x1f\x7f]/.test(object.summary)) throw Error('live_summary');
  const user = strictObject(object.user, ['present', 'quality', 'position', 'head', 'facingScreen', 'expression', 'mouthMoving']);
  const quality = strictObject(user.quality, ['score', 'basis']); finite(quality.score, 0, 1);
  if (!['tracking-stability', 'unavailable'].includes(quality.basis) || typeof user.present !== 'boolean') throw Error('live_quality');
  for (const key of ['facingScreen', 'mouthMoving']) if (user[key] !== null && typeof user[key] !== 'boolean') throw Error('live_boolean');
  nullableVector(user.position, ['x', 'y'], -1, 1); nullableVector(user.head, ['yaw', 'pitch', 'roll'], -180, 180);
  nullableVector(user.expression, ['smile', 'browRaise', 'eyesClosed', 'mouthOpen'], 0, 1);
  if (!user.present && [user.position, user.head, user.expression, user.facingScreen, user.mouthMoving].some(x => x !== null)) throw Error('live_absent_fields');
  return structuredClone(object) as Observation;
}

export class ObservationStore {
  private snapshot: Observation | null = null;
  private receivedAt: number | null = null;
  private events: LiveEvent[] = [];
  private next = 0;
  constructor(private maxAgeMs = 1500, private capacity = 64) {}
  ingest(value: unknown, events: { type: LiveEventKind; at: number }[], now: number) {
    const snapshot = validateObservation(value);
    if (this.snapshot && snapshot.sessionId !== this.snapshot.sessionId) throw Error('live_wrong_session');
    if (this.snapshot && snapshot.seq <= this.snapshot.seq) throw Error('live_stale_sequence');
    if (Math.abs(now - snapshot.capturedAt) > this.maxAgeMs) throw Error('live_expired');
    if (!Array.isArray(events) || events.length > 16) throw Error('live_event_budget');
    for (const event of events) {
      strictObject(event, ['type', 'at']);
      if (!eventKinds.includes(event.type) || !Number.isFinite(event.at) || Math.abs(now - event.at) > 5000) throw Error('live_event');
    }
    this.snapshot = snapshot; this.receivedAt = now;
    for (const event of events) this.events.push({ ...event, id: ++this.next });
    this.events = this.events.slice(-this.capacity);
  }
  read(cursor: number, now: number): ObservationRead {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.next) throw Error('live_cursor');
    const ageMs = this.snapshot ? Math.max(0, now - this.snapshot.capturedAt) : null;
    const stale = ageMs === null || ageMs > this.maxAgeMs || this.snapshot?.camera === 'stale';
    const snapshot = this.snapshot ? structuredClone(this.snapshot) : null;
    if (snapshot && stale) { snapshot.camera = 'stale'; snapshot.user = unavailableUser(); snapshot.summary = 'Quan sát đã cũ; chưa biết trạng thái người dùng.'; }
    return { snapshot, receivedAt: this.receivedAt, ageMs, stale, events: this.events.filter(event => event.id > cursor),
      cursor: this.next, gap: this.events.length > 0 && cursor < this.events[0].id - 1 };
  }
  reset() { this.snapshot = null; this.receivedAt = null; this.events = []; this.next = 0; }
}
