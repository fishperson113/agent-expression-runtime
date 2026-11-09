import { afterEach, expect, it, vi } from 'vitest';
import { LiveRecording } from '../src/live/recording';
const receipt = () => ({ requestId: 'request', modelConfigHash: 'a'.repeat(64), promptHash: 'b'.repeat(64), requestHash: 'c'.repeat(64),
  responseHash: null, outcome: 'transport_unknown' as const, durationMs: null, usage: 'unknown' as const });
function fixture() {
  let time = 0; const elements = new Map<string, object>();
  vi.spyOn(performance, 'now').mockImplementation(() => time); vi.spyOn(Date, 'now').mockImplementation(() => 10000 + time);
  vi.stubGlobal('document', { getElementById: (id: string) => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); } });
  return { recording: new LiveRecording(() => 'epoch', 'synthetic'), advance: (ms: number) => { time += ms; } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('accepts receipts only for the current active capture token, with no off-state input inspection or backfill', () => {
  const f = fixture(); expect(f.recording.captureToken()).toBeNull();
  const getter = vi.fn(() => 'PRIVATE'); const unsafe = Object.defineProperty({}, 'requestId', { get: getter });
  expect(f.recording.providerReceipt(null, unsafe)).toBe(false); expect(getter).not.toHaveBeenCalled();
  expect(f.recording.start()).toBe(true); const token = f.recording.captureToken()!;
  expect(f.recording.providerReceipt(token, receipt())).toBe(true);
  f.recording.stop(); expect(f.recording.captureToken()).toBeNull(); f.recording.start();
  expect(f.recording.providerReceipt(token, receipt())).toBe(false);
  const current = f.recording.captureToken()!; expect(current).not.toEqual(token);
  expect(f.recording.snapshot().records).toEqual([]); expect(f.recording.providerReceipt(current, receipt())).toBe(true);
});
it('rotates capture authority on clear, expiry, failed clocks and dispose without reviving old receipts', () => {
  const f = fixture(); f.recording.start(); const beforeClear = f.recording.captureToken()!;
  f.recording.clear(); f.recording.start(); const beforeExpiry = f.recording.captureToken()!;
  expect(f.recording.providerReceipt(beforeClear, receipt())).toBe(false);
  f.advance(60000); f.recording.tick(); expect(f.recording.captureToken()).toBeNull();
  f.recording.start(); const next = f.recording.captureToken()!;
  expect(f.recording.providerReceipt(beforeExpiry, receipt())).toBe(false); expect(next.generation).toBeGreaterThan(beforeExpiry.generation);
  f.recording.dispose(); expect(f.recording.providerReceipt(next, receipt())).toBe(false); expect(f.recording.start()).toBe(false);
});
it('rejects forged or accessor capture tokens and malformed receipts without invoking getters', () => {
  const f = fixture(); f.recording.start(); const token = f.recording.captureToken()!, getter = vi.fn(() => token.runId);
  const forged = Object.defineProperty({ generation: token.generation }, 'runId', { get: getter });
  expect(f.recording.providerReceipt(forged, receipt())).toBe(false); expect(getter).not.toHaveBeenCalled();
  expect(f.recording.providerReceipt({ ...token, secret: 'PRIVATE' }, receipt())).toBe(false);
  expect(f.recording.providerReceipt(token, { ...receipt(), body: 'PRIVATE' })).toBe(false);
  expect(JSON.stringify(f.recording.snapshot())).not.toContain('PRIVATE');
});
