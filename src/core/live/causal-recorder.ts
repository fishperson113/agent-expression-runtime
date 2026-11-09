import { inspect, object, project } from './causal-projection';
import type { CausalKind, CausalManifest, CausalPayloads, CausalRecord, CausalSnapshot, CausalStart, RecorderReason } from './causal-recorder-types';
export type RecorderOptions = { now: () => number; wallNow: () => number; epoch: () => string; maxRecords?: number; maxBytes?: number; ttlMs?: number };
const safeTime = (value: number) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
function bounded(value: number, min: number, max: number) { if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('recorder_options'); return value; }
function startMetadata(value: CausalStart) {
  inspect(value); const data = object(value, ['runId', 'mode'], ['sourceSha', 'seed', 'configHash']);
  if (typeof data.runId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.runId) || !['synthetic', 'live-structured'].includes(data.mode)) throw Error('invalid_metadata');
  if ('sourceSha' in data && (typeof data.sourceSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(data.sourceSha))) throw Error('invalid_metadata');
  if ('configHash' in data && (typeof data.configHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.configHash))) throw Error('invalid_metadata');
  if ('seed' in data && !Number.isSafeInteger(data.seed)) throw Error('invalid_metadata');
  return structuredClone(data) as CausalStart;
}
/** Opt-in in-memory causal evidence; no persistence, provider calls or replay engine. */
export class CausalRecorder {
  private manifest: CausalManifest | null = null;
  private records: CausalRecord[] = [];
  private recordBytes = 0;
  private sequence = 0;
  private observations = new Set<string>();
  private events = new Set<string>();
  private requests = new Set<string>();
  private lastMono = 0;
  private lastWall = 0;
  private limits;
  constructor(private options: RecorderOptions) {
    this.limits = { maxRecords: bounded(options.maxRecords ?? 2048, 1, 2048), maxBytes: bounded(options.maxBytes ?? 8 * 1024 * 1024, 2048, 8 * 1024 * 1024), ttlMs: bounded(options.ttlMs ?? 60000, 1, 1800000) };
  }
  start(value: CausalStart): boolean {
    let metadata, mono, wall;
    try { metadata = startMetadata(value); mono = this.options.now(); wall = this.options.wallNow(); if (!safeTime(mono) || !safeTime(wall) || !safeTime(mono + this.limits.ttlMs) || !safeTime(wall + this.limits.ttlMs)) return false; }
    catch { return false; }
    this.clear(); this.lastMono = mono; this.lastWall = wall;
    this.manifest = { ...metadata, active: true, incomplete: false, reasons: [], droppedRecords: 0, storedBytes: 0, recordCount: 0,
      clock: { monotonicOrigin: mono, wallOrigin: wall, observationCapturedAt: 'wall-ms', eventAt: 'wall-ms', requestDeadline: 'host-monotonic-ms', admissionValidUntil: 'host-monotonic-ms', executionValidUntil: 'host-monotonic-ms', executionAt: 'host-monotonic-ms' },
      ...this.limits, maxRecordBytes: 32768, expiresAtMono: mono + this.limits.ttlMs, expiresAtWall: wall + this.limits.ttlMs, ended: 'none' };
    this.updateBytes(); return true;
  }
  append<K extends CausalKind>(kind: K, payload: CausalPayloads[K]): boolean {
    if (!this.manifest) return false;
    this.tick(); if (!this.manifest?.active) return false;
    let record: CausalRecord, size: number;
    try {
      const epoch = this.options.epoch(); if (typeof epoch !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(epoch)) throw Error('invalid_payload');
      record = { seq: this.sequence + 1, kind, epoch, recordedAtMono: this.lastMono, recordedAtWall: this.lastWall, payload: project(kind, payload) };
      size = bytes(record); if (size > this.manifest.maxRecordBytes) throw Error('record_too_large');
    } catch (error) {
      this.mark(error instanceof Error && error.message === 'record_too_large' ? 'record_too_large' : 'invalid_payload'); return false;
    }
    if (this.records.length >= this.limits.maxRecords) { this.quota('record_quota'); return false; }
    if (this.totalBytes(size, this.records.length + 1) + 512 > this.limits.maxBytes) { this.quota('byte_quota'); return false; }
    this.records.push(record); this.sequence++; this.recordBytes += size; this.lineage(record); this.updateBytes(); return true;
  }
  tick() {
    if (!this.manifest || ['expired', 'clock_invalid'].includes(this.manifest.ended)) return;
    let mono, wall;
    try { mono = this.options.now(); wall = this.options.wallNow(); }
    catch { this.expire('clock_invalid'); return; }
    if (!safeTime(mono) || !safeTime(wall) || mono < this.lastMono || wall < this.lastWall) { this.expire('clock_invalid'); return; }
    this.lastMono = mono; this.lastWall = wall;
    if (mono >= this.manifest.expiresAtMono || wall >= this.manifest.expiresAtWall) this.expire('expired');
  }
  stop() { this.tick(); if (this.manifest?.active) { this.manifest.active = false; this.manifest.ended = 'stopped'; this.updateBytes(); } }
  clear() { this.manifest = null; this.records = []; this.recordBytes = 0; this.sequence = 0; this.clearParents(); }
  status(): CausalManifest | null { this.tick(); this.updateBytes(); return structuredClone(this.manifest); }
  snapshot(): CausalSnapshot { this.tick(); this.updateBytes(); return structuredClone({ schemaVersion: 1, manifest: this.manifest, records: this.records }); }
  private mark(reason: RecorderReason, dropped = 1) {
    if (!this.manifest) return;
    this.manifest.incomplete = true; this.manifest.droppedRecords = Math.min(Number.MAX_SAFE_INTEGER, this.manifest.droppedRecords + dropped);
    if (!this.manifest.reasons.includes(reason)) this.manifest.reasons.push(reason);
    this.updateBytes();
  }
  private quota(reason: 'record_quota' | 'byte_quota') {
    this.manifest!.active = false; this.manifest!.ended = 'quota'; this.mark(reason);
  }
  private expire(reason: 'expired' | 'clock_invalid') {
    this.manifest!.active = false; this.manifest!.ended = reason;
    const discarded = this.records.length; this.records = []; this.recordBytes = 0; this.clearParents(); this.mark(reason, discarded);
  }
  private clearParents() { this.observations.clear(); this.events.clear(); this.requests.clear(); }
  private lineage(record: CausalRecord) {
    const value = record.payload as Record<string, any>, reference = (ref: { sessionId: string; seq: number }) => `${ref.sessionId}:${ref.seq}`;
    let missing = false;
    if (record.kind === 'observation') this.observations.add(reference(value as any));
    if (record.kind === 'event') {
      missing = !this.observations.has(reference({ sessionId: value.sessionId, seq: value.observationSeq })) ||
        (value.eventVersion === 1 && !this.observations.has(reference({ sessionId: value.sessionId, seq: value.evidenceStartSeq }))); this.events.add(reference(value as any));
    }
    if (record.kind === 'request') {
      missing = value.observationRefs.some((ref: any) => !this.observations.has(reference(ref))) || value.eventRefs.some((ref: any) => !this.events.has(reference(ref))) || !value.observationRefs.length || !value.eventRefs.length;
      this.requests.add(value.request.requestId);
    }
    if (['authorization', 'decision', 'revocation', 'provider_receipt'].includes(record.kind) && value.requestId) missing = !this.requests.has(value.requestId);
    if (['execution', 'frame'].includes(record.kind) && value.origin === 'reactive') missing = !value.requestId || !this.requests.has(value.requestId);
    if (record.kind === 'revocation' && (value.actionId || value.decisionId) && !value.requestId) missing = true;
    if (missing) this.mark('missing_parent', 0);
  }
  private totalBytes(extra = 0, count = this.records.length) {
    return bytes({ schemaVersion: 1, manifest: this.manifest, records: [] }) + this.recordBytes + extra + Math.max(0, count - 1);
  }
  private updateBytes() { if (this.manifest) this.manifest.recordCount = this.records.length; if (this.manifest) for (let i = 0; i < 3; i++) this.manifest.storedBytes = this.totalBytes(); }
}
