import { expect, it } from 'vitest';
import { SceneTrace } from '../src/core/live/trace';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

it('keeps admission, scheduler application and rendered-frame change separate and bounded', () => {
  const trace = new SceneTrace();
  trace.activity('working');
  trace.record(1, 'received', 0); trace.record(1, 'admitted', 1);
  trace.frame(10, 123, 2);
  expect(trace.snapshot().events.some(event => event.phase === 'frame_changed_proxy')).toBe(false);
  trace.record(1, 'applied', 3); trace.frame(11, 123, 4);
  expect(trace.snapshot().events.some(event => event.phase === 'frame_submitted')).toBe(true);
  expect(trace.snapshot().events.some(event => event.phase === 'frame_changed_proxy')).toBe(false);
  trace.frame(12, 999, 5);
  expect(trace.snapshot().events.at(-1)?.phase).toBe('frame_changed_proxy');
  for (let i = 0; i < 100; i++) trace.record(i, 'rejected', i, 'bad_token private prompt');
  expect(trace.snapshot().events).toHaveLength(64);
  expect(JSON.stringify(trace.snapshot())).not.toContain('private prompt');
  expect(trace.snapshot().turn).toBe(1);
});

it('labels opt-in synthetic observations and handles present, stale, denied and stop without camera capture', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls!.local[0] + 'live.html?fixture=synthetic');
    await page.waitForFunction(() => !!(window as any).fischLive);
    expect(await page.locator('#camera-start').isDisabled()).toBe(true);
    const markerAlpha = () => page.locator('#landmarks').evaluate(canvas => (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(320, 240, 1, 1).data[3]);
    await page.evaluate(() => (window as any).fischLive.fixture('present'));
    expect(await markerAlpha()).toBeGreaterThan(0);
    await page.evaluate(() => (window as any).fischLive.fixture('absent'));
    expect(await markerAlpha()).toBe(0);
    for (const mode of ['present', 'absent', 'denied', 'error', 'stale']) {
      await page.evaluate(mode => (window as any).fischLive.fixture(mode), mode);
      expect(await page.evaluate(() => (window as any).fischLive.metrics().cameraActive)).toBe(false);
      expect(await page.locator('#camera-status').textContent()).toContain('tổng hợp');
    }
    await page.getByRole('button', { name: 'Dừng toàn bộ' }).click();
    await expect(page.evaluate(() => (window as any).fischLive.fixture('present'))).rejects.toThrow('synthetic_fixture_unavailable');
  } finally { await browser?.close(); await server.close(); }
}, 45000);
it('clears pending render attribution on cancellation so old work cannot mark a later frame', () => {
  const trace = new SceneTrace();
  trace.frame(1, 10, 0); trace.record(2, 'applied', 1); trace.record(2, 'cancelled', 2); trace.frame(2, 11, 3);
  expect(trace.snapshot().events.some(event => event.phase === 'frame_changed_proxy')).toBe(false);
});
it('preserves local frame attribution across a colliding Native cancellation', () => {
  const trace = new SceneTrace(), owner = { origin: 'reactive' as const, requestId: 'r1', decisionId: 'd1', actionId: 'a1' };
  trace.frame(1, 10, 0); trace.record(1, 'applied', 1, undefined, 'local', owner);
  trace.record(1, 'cancelled', 2, undefined, 'local', { origin: 'native' }); trace.frame(2, 11, 3);
  expect(trace.snapshot().events.filter(event => event.phase.startsWith('frame_'))).toEqual([
    expect.objectContaining({ ...owner, phase: 'frame_submitted' }), expect.objectContaining({ ...owner, phase: 'frame_changed_proxy' })]);
  trace.record(2, 'applied', 4, undefined, 'local', owner); trace.record(2, 'cancelled', 5, undefined, 'local', owner); trace.frame(3, 12, 6);
  expect(trace.snapshot().events.filter(event => event.phase.startsWith('frame_'))).toHaveLength(2);
});
it('bounds and sanitizes attribution without retaining arbitrary contextual fields', () => {
  const trace = new SceneTrace();
  for (let seq = 0; seq < 100; seq++) trace.record(seq, 'received', seq, undefined, 'local', { origin: 'native', requestId: 'bad private context', decisionId: 'x'.repeat(65), actionId: 'safe-id', privateContext: 'secret' } as any);
  expect(trace.snapshot().events).toHaveLength(64);
  expect(trace.snapshot().events.at(-1)).toEqual(expect.objectContaining({ origin: 'native', actionId: 'safe-id' }));
  expect(JSON.stringify(trace.snapshot())).not.toMatch(/private|secret|requestId|decisionId/);
});
