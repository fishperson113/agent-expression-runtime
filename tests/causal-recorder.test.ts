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
it('strictly projects provider receipts with a known request parent and rejects all raw or malformed fields', () => {
  const receipt = { requestId: 'request', modelConfigHash: 'a'.repeat(64), promptHash: 'b'.repeat(64), requestHash: 'c'.repeat(64),
    responseHash: null, outcome: 'transport_unknown' as const, durationMs: null, usage: 'unknown' as const };
  const f = setup(); f.recorder.start(begin); f.recorder.append('observation', observation());
  f.recorder.append('event', { sessionId: 'session', observationSeq: 1, seq: 1, type: 'user_arrived', at: 10000 });
  f.recorder.append('request', request()); expect(f.recorder.append('provider_receipt', receipt)).toBe(true);
  expect(f.recorder.snapshot().records.at(-1)?.payload).toEqual(receipt); expect(f.recorder.status()?.incomplete).toBe(false);
  const valid = { ...receipt, outcome: 'completed' as const, responseHash: 'd'.repeat(64), durationMs: 12.5,
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } };
  expect(f.recorder.append('provider_receipt', valid)).toBe(true);
  for (const value of [{ ...receipt, raw: 'PRIVATE' }, { ...receipt, modelConfigHash: 'secret model' }, { ...receipt, responseHash: 'bad' },
    { ...receipt, durationMs: Infinity }, { ...receipt, usage: { ...valid.usage, hidden: 'PRIVATE' } },
    { ...receipt, usage: { ...valid.usage, total_tokens: 0.5 } }, { ...receipt, outcome: 'PRIVATE' }])
    expect(f.recorder.append('provider_receipt', value as any)).toBe(false);
  expect(JSON.stringify(f.recorder.snapshot())).not.toMatch(/PRIVATE|secret model|"raw"/);
  const g = setup(); g.recorder.start(begin); expect(g.recorder.append('provider_receipt', receipt)).toBe(true);
  expect(g.recorder.status()?.reasons).toEqual(['missing_parent']);
});
const scopedRequest = () => ({ ...request(), request: { ...request().request, schemaVersion: 2 as const,
  semanticSnapshot: { orientation: null, expression: 4, handMotion: null, handIdentity: 7 } } });
it('preserves explicit request versions and nullable semantic state without replacing unknowns or losing parent refs', () => {
  const f = setup(); f.recorder.start(begin); f.recorder.append('observation', observation());
  f.recorder.append('event', { sessionId: 'session', observationSeq: 1, seq: 1, type: 'user_arrived', at: 10000 });
  expect(f.recorder.append('request', request())).toBe(true);
  const value = scopedRequest(); value.request.requestId = 'scoped_request';
  expect(f.recorder.append('request', value)).toBe(true);
  const records = f.recorder.snapshot().records.filter(record => record.kind === 'request');
  expect(records[0].payload).toEqual(request()); expect(records[1].payload).toEqual(value);
  expect(f.recorder.status()?.incomplete).toBe(false);
  value.request.semanticSnapshot.expression = 999;
  expect((f.recorder.snapshot().records.at(-1)?.payload as any).request.semanticSnapshot).toEqual({ orientation: null, expression: 4, handMotion: null, handIdentity: 7 });
  expect(f.recorder.status()?.clock).toMatchObject({ requestDeadline: 'host-monotonic-ms', admissionValidUntil: 'host-monotonic-ms', executionValidUntil: 'host-monotonic-ms', observationCapturedAt: 'wall-ms' });
});
it('rejects unknown request versions, nullable hand identity, missing version-two axes and version-one semantic additions', () => {
  const f = setup(); f.recorder.start(begin);
  const invalid = [ { ...request(), request: { ...request().request, schemaVersion: 3 } },
    { ...request(), request: { ...request().request, semanticSnapshot: scopedRequest().request.semanticSnapshot } } ];
  for (const value of invalid) expect(f.recorder.append('request', value as any)).toBe(false);
  for (const axis of ['orientation', 'expression', 'handMotion', 'handIdentity']) {
    const value = scopedRequest() as any; delete value.request.semanticSnapshot[axis]; expect(f.recorder.append('request', value)).toBe(false);
  }
  for (const patch of [{ handIdentity: null }, { handIdentity: -1 }, { handMotion: Infinity }, { expression: 0.5 }, { orientation: NaN }, { hidden: 'PRIVATE' }]) {
    const value = scopedRequest(); Object.assign(value.request.semanticSnapshot, patch); expect(f.recorder.append('request', value)).toBe(false);
  }
  const missing = scopedRequest() as any; delete missing.request.presenceRevision; expect(f.recorder.append('request', missing)).toBe(false);
  expect(f.recorder.snapshot().records).toEqual([]); expect(JSON.stringify(f.recorder.snapshot())).not.toContain('PRIVATE');
});
it('stores trusted scoped outcome metadata with a separate execution expiry and no raw decision body', () => {
  const f = setup(); f.recorder.start(begin); f.recorder.append('observation', observation());
  f.recorder.append('event', { sessionId: 'session', observationSeq: 1, seq: 1, type: 'user_arrived', at: 10000 });
  f.recorder.append('request', scopedRequest());
  const accepted = { requestId: 'request', decisionId: 'scoped_decision', actionId: 'scoped_action', reason: 'accepted' as const,
    mode: 'express' as const, validUntil: 150, decisionVersion: 2 as const, prerequisites: ['expression' as const], executionValidUntil: 900 };
  expect(f.recorder.append('decision', accepted)).toBe(true);
  expect(f.recorder.snapshot().records.at(-1)?.payload).toEqual(accepted);
  expect(f.recorder.append('decision', { requestId: 'request', reason: 'observed', mode: 'observe', decisionVersion: 2, prerequisites: [] })).toBe(true);
  expect(f.recorder.append('decision', { requestId: 'request', reason: 'stale', decisionVersion: 2, prerequisites: ['expression'] })).toBe(true);
  expect(f.recorder.status()?.incomplete).toBe(false);
  expect((f.recorder.snapshot().records[3].payload as any).executionValidUntil).toBeGreaterThan(accepted.validUntil);
});
it('rejects forged outcome versions, dependency lists, failed-admission execution authority and raw-output metadata', () => {
  const f = setup(); f.recorder.start(begin);
  const base = { requestId: 'request', reason: 'accepted', decisionVersion: 2, prerequisites: [] };
  for (const patch of [{ decisionVersion: 1 }, { decisionVersion: 3 }, { prerequisites: ['orientation', 'orientation'] }, { prerequisites: ['PRIVATE'] },
    { prerequisites: [null] }, { executionValidUntil: NaN }, { executionValidUntil: -1 },
    { reason: 'admission_failed', executionValidUntil: 1000 }, { reason: 'observed', executionValidUntil: 1000 },
    { reason: 'invalid_decision' }, { raw: 'PRIVATE' }, { body: { text: 'PRIVATE' } }, { output: 'PRIVATE' }])
    expect(f.recorder.append('decision', { ...base, ...patch } as any)).toBe(false);
  const missing = { ...base } as any; delete missing.prerequisites; expect(f.recorder.append('decision', missing)).toBe(false);
  const legacy = { requestId: 'request', reason: 'accepted', executionValidUntil: 1000 };
  expect(f.recorder.append('decision', legacy as any)).toBe(false);
  expect(f.recorder.append('decision', { schemaVersion: 2, requestId: 'request', decisionId: 'raw', mode: 'express', validUntil: 5000,
    prerequisites: [], action: { body: 'PRIVATE' } } as any)).toBe(false);
  expect(f.recorder.snapshot().records).toEqual([]); expect(JSON.stringify(f.recorder.snapshot())).not.toContain('PRIVATE');
});
it('keeps scoped recording bounded and does not backfill a request captured after its source evidence', () => {
  const f = setup({ ttlMs: 50 }); f.recorder.start(begin);
  expect(f.recorder.append('request', scopedRequest())).toBe(true);
  expect(f.recorder.status()).toMatchObject({ incomplete: true, reasons: ['missing_parent'], droppedRecords: 0 });
  expect(f.recorder.snapshot().records.map(record => record.kind)).toEqual(['request']);
  f.recorder.stop(); f.advance(50); expect(f.recorder.snapshot().records).toEqual([]);
  expect(f.recorder.status()?.ended).toBe('expired');
});
