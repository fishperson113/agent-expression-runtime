import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveModelTurn } from '../integrations/live-model-budget.mjs';
import { scoreContract } from '../scripts/live-holdout.mjs';
import { runModelTurn } from '../integrations/live-model-client.mjs';
import { EventEmitter } from 'node:events';
import { holdoutCapture } from '../integrations/live-holdout-capture.mjs';
const directories = [];
function budget(values = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fisch-budget-')); directories.push(directory);
  const path = join(directory, 'budget.json');
  writeFileSync(path, JSON.stringify({ startedAt: '2026-11-08T16:41:03Z', deadline: '2026-11-08T22:41:03Z', limit: 120, used: 119, turns: [], ...values }));
  return path;
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
it('counts a turn before sending and refuses the next turn without resetting the shared counter', () => {
  const path = budget();
  expect(reserveModelTurn(path, 'final-holdout', Date.parse('2026-11-08T18:00:00Z')).used).toBe(120);
  expect(() => reserveModelTurn(path, 'retry', Date.parse('2026-11-08T18:01:00Z'))).toThrow('budget_exhausted');
  expect(JSON.parse(readFileSync(path)).used).toBe(120);
});
it('ends a model test promptly on transport loss and removes its listeners', async () => {
  const events = new EventEmitter(), client = { events, call: async () => queueMicrotask(() => events.emit('closed')) };
  await expect(runModelTurn(client, 't', 'synthetic prompt', 10000)).rejects.toThrow('app_server_closed');
  expect(events.listenerCount('notification')).toBe(0); expect(events.listenerCount('closed')).toBe(0);
});
it('does not score ACKs as application or visual meaning and correlates epochs', () => {
  const turn = { status: 'completed', tools: [{ server: 'fisch_live', tool: 'express', result: { content: [{ type: 'text', text: '{"status":"accepted","seq":1,"epoch":"current"}' }] } }] };
  const result = scoreContract(turn, { diagnostics: { events: [{ seq: 1, epoch: 'old', phase: 'applied' }] } });
  expect(result.admitted).toBe(1); expect(result.applied).toBe(0);
  expect(result.visualEffectiveness).toBe(null); expect(result.contentRelevance).toBe(null);
});
it('retains bounded machine rejection codes without raw model payloads', () => {
  const tools = ['session_busy', 'private text or payload', 'x'.repeat(65), undefined].map(code => ({ server: 'fisch_live', tool: 'express',
    result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', code }) }] } }));
  const result = scoreContract({ status: 'completed', tools }, { diagnostics: { events: [] } });
  expect(result.rejected).toBe(4); expect(result.rejectionCodes).toEqual(['session_busy']);
});
it('uses real protocol event boundaries in the deterministic client fixture', async () => {
  const events = new EventEmitter(), captured = [];
  const client = { events, call: async method => {
    if (method === 'turn/start') queueMicrotask(() => {
      events.emit('notification', { method: 'turn/started', params: { threadId: 't', turn: { id: 'a' } } });
      const item = { type: 'mcpToolCall', tool: 'express' };
      events.emit('notification', { method: 'item/completed', params: { threadId: 't', turnId: 'old', item } });
      events.emit('notification', { method: 'item/completed', params: { threadId: 'other', turnId: 'a', item } });
      events.emit('notification', { method: 'item/completed', params: { threadId: 't', turnId: 'a', item } });
      events.emit('notification', { method: 'turn/completed', params: { threadId: 'other', turn: { id: 'a', status: 'failed' } } });
      events.emit('notification', { method: 'turn/completed', params: { threadId: 't', turn: { id: 'stale', status: 'failed' } } });
      events.emit('notification', { method: 'turn/completed', params: { threadId: 't', turn: { id: 'a', status: 'completed' } } });
    });
  } };
  expect((await runModelTurn(client, 't', 'synthetic test prompt', 1000, item => captured.push(item))).status).toBe('completed');
  expect(captured).toHaveLength(1);
  expect(events.listenerCount('notification')).toBe(0);
});
it('bounds active holdout evidence to body-only captures and reports unavailable frames', async () => {
  const selectors = [], paths = [];
  const page = { waitForTimeout: async () => {}, locator: selector => {
    selectors.push(selector);
    return { screenshot: async ({ path }) => { paths.push(path); if (paths.length === 2) throw Error('closed'); } };
  } };
  const capture = holdoutCapture(page, '/tmp', 'h01');
  capture.capture({ server: 'other', tool: 'express' });
  capture.capture({ server: 'fisch_live', tool: 'look' });
  for (let i = 0; i < 10; i++) capture.capture({ server: 'fisch_live', tool: 'express' });
  const report = await capture.finish();
  expect(paths).toHaveLength(4); expect(new Set(selectors)).toEqual(new Set(['#body']));
  expect(report.failed).toBe(1); expect(report.frames).toHaveLength(3);
});
it('fails closed at the deadline or concurrent lock and preserves the original file', () => {
  const path = budget({ used: 2 }), original = readFileSync(path, 'utf8');
  expect(() => reserveModelTurn(path, 'late', Date.parse('2026-11-08T22:41:03Z'))).toThrow('deadline');
  mkdirSync(path + '.lock');
  expect(() => reserveModelTurn(path, 'parallel', Date.parse('2026-11-08T18:00:00Z'))).toThrow();
  expect(readFileSync(path, 'utf8')).toBe(original);
});

it('generates unique blind codes without exposing prompt IDs or presentation order', async () => {
  const { blindCodes } = await import('../integrations/live-holdout-video.mjs');
  const codes = blindCodes(20);
  expect(new Set(codes).size).toBe(20);
  expect(codes.every(code => /^V-[A-F0-9]{8}$/.test(code))).toBe(true);
});

it('marks a scoring kit incomplete until all recordings finish and keeps the key outside it', async () => {
  const { writeScoringPack } = await import('../integrations/live-holdout-video.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'fisch-scoring-')); directories.push(directory);
  const codes = ['V-ABCDEF12', 'V-12345678'];
  writeScoringPack(directory, codes);
  expect(readFileSync(join(directory, 'blind/index.html'), 'utf8')).toContain('BỘ CHƯA HOÀN TẤT');
  const sheet = readFileSync(join(directory, 'blind/scoring.csv'), 'utf8');
  expect(sheet).toContain('theme_guess,emotion_guess'); expect(sheet).not.toMatch(/h01|prompt|pass/);
  writeScoringPack(directory, codes, true);
  expect(readFileSync(join(directory, 'blind/index.html'), 'utf8')).not.toContain('BỘ CHƯA HOÀN TẤT');
  expect(() => readFileSync(join(directory, 'blind/answer-key.json'))).toThrow();
});

it('honors an explicitly configured larger authorized budget without resetting or expanding it', () => {
  const path = budget({ limit: 1000, used: 999 });
  expect(reserveModelTurn(path, 'explicit-channel-trial', Date.parse('2026-11-08T18:00:00Z')).used).toBe(1000);
  expect(() => reserveModelTurn(path, 'extra', Date.parse('2026-11-08T18:01:00Z'))).toThrow('budget_exhausted');
  expect(JSON.parse(readFileSync(path)).limit).toBe(1000);
});
