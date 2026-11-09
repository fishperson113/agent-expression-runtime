import { expect, it, vi } from 'vitest';
import { CausalRecorder } from '../src/core/live/causal-recorder';
import { unavailableUser } from '../src/core/live/types';
function setup(options = {}) {
  let mono = 100, wall = 10000;
  const now = vi.fn(() => mono), wallNow = vi.fn(() => wall), epoch = vi.fn(() => 'epoch');
  const recorder = new CausalRecorder({ now, wallNow, epoch, ...options });
  return { recorder, now, wallNow, epoch, advance: (ms: number) => { mono += ms; wall += ms; }, rollback: () => { mono--; } };
}
const begin = { runId: 'run_1', mode: 'synthetic' as const };
const observation = () => ({ v: 1 as const, sessionId: 'session', seq: 1, capturedAt: 10000, camera: 'absent' as const, user: unavailableUser(), turn: 'idle' as const, summary: 'PRIVATE summary must disappear' });
const request = () => ({ request: { schemaVersion: 1 as const, sessionId: 'session', epoch: 'epoch', requestId: 'request', intentRevision: 0, presenceRevision: 1, deadline: 5100, requiredTrackIds: [] }, observationRefs: [{ sessionId: 'session', seq: 1 }], eventRefs: [{ sessionId: 'session', seq: 1 }] });
it('is inert by default and stores only scrubbed causal data after explicit start', () => {
  const f = setup(); expect(f.recorder.append('observation', observation())).toBe(false);
  expect(f.recorder.snapshot()).toEqual({ schemaVersion: 1, manifest: null, records: [] }); expect(f.now).not.toHaveBeenCalled();
  expect(f.recorder.start(begin)).toBe(true);
  expect(f.recorder.append('observation', observation())).toBe(true);
  expect(f.recorder.append('event', { sessionId: 'session', observationSeq: 1, seq: 1, type: 'user_arrived', at: 10000 })).toBe(true);
  expect(f.recorder.append('request', Object.freeze(request()))).toBe(true);
  expect(f.recorder.append('authorization', { requestId: 'request', allowed: true, reason: 'authorized' })).toBe(true);
  expect(f.recorder.append('decision', { requestId: 'request', decisionId: 'decision', actionId: 'action', reason: 'accepted', mode: 'express', validUntil: 5000 })).toBe(true);
  expect(f.recorder.append('execution', { seq: 1, epoch: 'epoch', phase: 'applied', at: 110, origin: 'reactive', requestId: 'request', decisionId: 'decision', actionId: 'action' })).toBe(true);
  expect(f.recorder.append('frame', { frame: 2, signature: 123, origin: 'reactive', requestId: 'request', actionId: 'action' })).toBe(true);
  const exported = f.recorder.snapshot(); expect(JSON.stringify(exported)).not.toContain('PRIVATE');
  expect(exported.records[2].payload).toEqual(request()); expect(exported.records[0]).toMatchObject({ recordedAtMono: 100, recordedAtWall: 10000 });
  expect(exported.manifest?.clock).toMatchObject({ observationCapturedAt: 'wall-ms', requestDeadline: 'host-monotonic-ms' });
  expect(exported.manifest?.storedBytes).toBe(new TextEncoder().encode(JSON.stringify(exported)).length);
  exported.records.length = 0; expect(f.recorder.snapshot().records).toHaveLength(7);
});
it('rejects injected context, raw decisions, prototypes, accessors, cycles and nonfinite fields without executing getters', () => {
  const f = setup(); f.recorder.start(begin); const getter = vi.fn(() => 'private');
  const accessor = Object.defineProperty({}, 'requestId', { enumerable: true, get: getter });
  const cyclic: any = { requestId: 'request' }; cyclic.self = cyclic;
  const malicious = [accessor, cyclic, Object.create({ requestId: 'request' }), { ...observation(), transcript: 'PRIVATE' }, JSON.parse('{"__proto__":{"secret":"PRIVATE"}}'),
    { requestId: 'request', reason: 'accepted', action: { body: 'PRIVATE' } }, { requestId: 'request', reason: 'accepted', validUntil: NaN }];
  for (const payload of malicious) expect(f.recorder.append('decision', payload as any)).toBe(false);
  expect(getter).not.toHaveBeenCalled(); expect(f.recorder.snapshot().records).toEqual([]);
  expect(f.recorder.status()).toMatchObject({ active: true, incomplete: true, droppedRecords: malicious.length, reasons: ['invalid_payload'] });
  expect(JSON.stringify(f.recorder.snapshot())).not.toContain('PRIVATE');
});
it('preserves the prefix on record/byte quotas and enforces hard limits', () => {
  const f = setup({ maxRecords: 1 }); f.recorder.start(begin);
  expect(f.recorder.append('observation', observation())).toBe(true);
  expect(f.recorder.append('frame', { frame: 1 })).toBe(false);
  expect(f.recorder.snapshot().records).toHaveLength(1); expect(f.recorder.status()).toMatchObject({ active: false, incomplete: true, ended: 'quota', reasons: ['record_quota'] });
  const b = setup({ maxBytes: 2048 }); b.recorder.start(begin);
  for (let i = 0; i < 100; i++) if (!b.recorder.append('frame', { frame: i })) break;
  const snapshot = b.recorder.snapshot(); expect(snapshot.manifest?.reasons).toContain('byte_quota');
  expect(new TextEncoder().encode(JSON.stringify(snapshot)).length).toBeLessThanOrEqual(2048);
  for (const options of [{ maxBytes: 9 * 1024 * 1024 }, { maxRecords: 2049 }, { ttlMs: 1800001 }, { ttlMs: NaN }]) expect(() => setup(options)).toThrow('recorder_options');
});
it('clears retained data at TTL even after stop and exposes explicit expiration status', () => {
  for (const operation of ['tick', 'snapshot', 'append', 'status'] as const) {
    const f = setup({ ttlMs: 50 }); f.recorder.start(begin); f.recorder.append('observation', observation()); f.recorder.stop();
    expect(f.recorder.snapshot().records).toHaveLength(1); f.advance(50);
    if (operation === 'append') f.recorder.append('frame', { frame: 2 }); else f.recorder[operation]();
    expect(f.recorder.snapshot().records).toEqual([]); expect(f.recorder.status()).toMatchObject({ active: false, incomplete: true, ended: 'expired', reasons: ['expired'], recordCount: 0 });
  }
});
it('contains oversized/deep input and failed epoch callbacks; clock failure clears sensitive retained values', () => {
  const f = setup(); f.recorder.start(begin); f.recorder.append('observation', observation());
  expect(f.recorder.append('decision', { requestId: 'x'.repeat(40000), reason: 'accepted' } as any)).toBe(false);
  expect(f.recorder.status()?.reasons).toContain('record_too_large');
  let deep: any = {}; for (let i = 0; i < 15; i++) deep = { child: deep };
  expect(f.recorder.append('frame', deep)).toBe(false);
  f.epoch.mockImplementation(() => { throw Error('PRIVATE sink failure'); });
  expect(() => f.recorder.append('frame', { frame: 3 })).not.toThrow(); expect(f.recorder.append('frame', { frame: 3 })).toBe(false);
  f.rollback(); expect(f.recorder.snapshot().records).toEqual([]); expect(f.recorder.status()?.ended).toBe('clock_invalid');
  expect(JSON.stringify(f.recorder.snapshot())).not.toContain('PRIVATE'); f.recorder.clear(); expect(f.recorder.status()).toBeNull();
});
it('rejects future schema/untrusted metadata and never persists raw failure text', () => {
  const f = setup(); expect(f.recorder.start({ ...begin, token: 'PRIVATE' } as any)).toBe(false);
  expect(f.recorder.status()).toBeNull(); f.recorder.start(begin);
  expect(f.recorder.append('observation', { ...observation(), v: 2 } as any)).toBe(false);
  expect(f.recorder.append('request', { ...request(), request: { ...request().request, schemaVersion: 2 } } as any)).toBe(false);
  expect(f.recorder.append('revocation', { reason: 'PRIVATE arbitrary string' } as any)).toBe(false);
  expect(f.recorder.append('execution', { seq: 1, epoch: 'epoch', phase: 'applied', at: 110, code: 'PRIVATE' } as any)).toBe(false);
  expect(f.recorder.append('authorization', { requestId: 'request', allowed: true, reason: 'denied' })).toBe(false);
  expect(JSON.stringify(f.recorder.snapshot())).not.toContain('PRIVATE');
});
it('marks mid-turn capture incomplete without backfilling pre-consent observations or pretending parents exist', () => {
  const f = setup(); f.recorder.start(begin);
  expect(f.recorder.append('request', request())).toBe(true);
  expect(f.recorder.snapshot().records.map(record => record.kind)).toEqual(['request']);
  expect(f.recorder.status()).toMatchObject({ incomplete: true, droppedRecords: 0, reasons: ['missing_parent'] });
  f.recorder.clear(); f.recorder.start(begin);
  f.recorder.append('authorization', { requestId: 'pre_consent_request', allowed: true, reason: 'authorized' });
  f.recorder.append('decision', { requestId: 'pre_consent_request', reason: 'accepted' });
  f.recorder.append('execution', { seq: 1, epoch: 'epoch', phase: 'applied', at: 100, origin: 'reactive', requestId: 'pre_consent_request' });
  f.recorder.append('revocation', { reason: 'revoked', actionId: 'pre_consent_action' });
  expect(f.recorder.status()).toMatchObject({ incomplete: true, recordCount: 4, droppedRecords: 0, reasons: ['missing_parent'] });
  expect(f.recorder.snapshot().records.some(record => record.kind === 'observation')).toBe(false);
});
it('clears the private buffer when an injected clock throws and exports only fixed failure metadata', () => {
  const f = setup(); f.recorder.start(begin); f.recorder.append('observation', observation());
  f.now.mockImplementation(() => { throw Error('PRIVATE clock exception'); });
  expect(() => f.recorder.snapshot()).not.toThrow(); expect(f.recorder.status()?.ended).toBe('clock_invalid');
  expect(f.recorder.snapshot().records).toEqual([]); expect(JSON.stringify(f.recorder.snapshot())).not.toContain('PRIVATE');
});
