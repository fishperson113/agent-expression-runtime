import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Repertoire } from '../integrations/planner-repertoire.mjs';
import { ExpressionPlanner } from '../integrations/expression-planner.mjs';
import { paneActivity } from '../integrations/planner-bridge.mjs';
import { TerminalEngine } from '../src/terminal/runtime.ts';

const body = x => ({ type: 'sequence', children: [{ type: 'parallel', children: [{ type: 'assemble', durationMs: 200,
  parts: [{ id: 'figure', kind: 'curve', points: [[-0.5, x, 0], [0, 0.6, 0], [0.5, x, 0]], radius: 0.03 }] }] }] });
it('deduplicates renamed geometry, rotates distinct forms and bounds the stored library', () => {
  const pool = new Repertoire();
  pool.remember(body(0), 'arch'); const renamed = body(0); renamed.children[0].children[0].parts[0].id = 'renamed';
  expect(pool.remember(renamed, 'same')).toBe(false);
  for (let i = 1; i < 12; i++) pool.remember(body(i / 10), 'form-' + i);
  expect(pool.info.size).toBe(8);
  const first = pool.pick(); expect(pool.pick(first.key).key).not.toBe(first.key);
});
it('restores geometry-only cache and rejects oversized cache files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fisch-library-test-')), file = join(directory, 'library.json');
  try {
    const pool = new Repertoire(file); pool.remember(body(0), 'arch');
    expect(new Repertoire(file).info.size).toBe(1);
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')))).toEqual(['v', 'plans']);
    writeFileSync(file, 'x'.repeat(262145));
    expect(new Repertoire(file).info).toMatchObject({ size: 0, cacheError: 'repertoire_cache_invalid' });
  } finally { rmSync(file, { force: true }); rmdirSync(directory); }
});
it('keeps an in-flight working plan relevant when the same turn becomes idle', async () => {
  let resolve; const received = [];
  const planner = new ExpressionPlanner({ engine: { express(value) { received.push(value); return { status: 'accepted' }; } },
    readContext: async () => 'same conversation', plan: () => new Promise(done => { resolve = done; }) });
  planner.update('working'); planner.tick(); await planner.reading;
  planner.update('done'); resolve({ body: body(0), concept: 'arch' }); await planner.job;
  expect(received).toHaveLength(1); expect(planner.info.discarded).toBe(0); planner.close();
});
it('preserves assembled geometry across normal status changes and serves the repertoire without a model call', async () => {
  let now = 0, text = 'current topic', calls = 0;
  const engine = new TerminalEngine(() => now);
  const activity = paneActivity(engine, {}, async () => ({ read: { text } }), { enabled: false },
    { now: () => now, plan: async () => { calls++; return { body: body(0), concept: 'arch' }; } });
  try {
    activity.update('working'); activity.tick(); for (let i = 0; i < 10; i++) await Promise.resolve();
    now = 300; engine.frame(64, 64); expect(engine.state.shape).toBe('assembled');
    activity.update('idle'); now = 700; engine.frame(64, 64);
    expect(engine.state.shape).toBe('assembled'); expect(activity.source).toBe('planner');
    now = 13000; activity.tick(); for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(activity.planner.repertoirePlays).toBe(1); expect(calls).toBe(1);
    activity.update('working'); now += 300; engine.frame(64, 64); expect(engine.state.shape).toBe('assembled');
  } finally { activity.close(); engine.dispose(); }
});
