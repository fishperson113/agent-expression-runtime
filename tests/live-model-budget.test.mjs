import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveModelTurn } from '../integrations/live-model-budget.mjs';
import { scoreContract } from '../scripts/live-holdout.mjs';
import { runModelTurn } from '../integrations/live-model-client.mjs';
import { EventEmitter } from 'node:events';
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
it('uses real protocol event boundaries in the deterministic client fixture', async () => {
  const events = new EventEmitter();
  const client = { events, call: async method => {
    if (method === 'turn/start') queueMicrotask(() => {
      events.emit('notification', { method: 'turn/started', params: { threadId: 't', turn: { id: 'a' } } });
      events.emit('notification', { method: 'turn/completed', params: { threadId: 'other', turn: { id: 'a', status: 'failed' } } });
      events.emit('notification', { method: 'turn/completed', params: { threadId: 't', turn: { id: 'stale', status: 'failed' } } });
      events.emit('notification', { method: 'turn/completed', params: { threadId: 't', turn: { id: 'a', status: 'completed' } } });
    });
  } };
  expect((await runModelTurn(client, 't', 'synthetic test prompt', 1000)).status).toBe('completed');
  expect(events.listenerCount('notification')).toBe(0);
});
it('fails closed at the deadline or concurrent lock and preserves the original file', () => {
  const path = budget({ used: 2 }), original = readFileSync(path, 'utf8');
  expect(() => reserveModelTurn(path, 'late', Date.parse('2026-11-08T22:41:03Z'))).toThrow('deadline');
  mkdirSync(path + '.lock');
  expect(() => reserveModelTurn(path, 'parallel', Date.parse('2026-11-08T18:00:00Z'))).toThrow();
  expect(readFileSync(path, 'utf8')).toBe(original);
});
