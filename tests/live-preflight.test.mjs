import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeReply } from '../integrations/live-probe.mjs';
import { createPreflightFixture, describePreflight, promptContext, runPreflight } from '../scripts/live-preflight.mjs';

const directories = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function trial(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fisch-preflight-budget-')); directories.push(root);
  const budgetPath = join(root, 'fixture-budget.json'), directory = join(root, 'output');
  let time = Date.parse('2026-11-10T12:00:00Z');
  const budget = { limit: 120, used: 100, deadline: new Date(time + 100000).toISOString(), turns: [] };
  const save = value => writeFileSync(budgetPath, JSON.stringify(value)); save(budget);
  const makeFixture = vi.fn(async () => ({ image: 'synthetic-only.png', digits: '7777' }));
  const run = vi.fn(async () => {
    writeFileSync(join(directory, 'calls.jsonl'), ['observe', 'look'].map(tool => JSON.stringify({ tool })).join('\n'));
    return JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '7777' } });
  });
  const options = { budgetPath, directory, env: { FISCH_RUN_MODEL_TESTS: '1' }, now: () => time,
    makeFixture, makePlanner: () => ({ command: 'fixture-never-spawned', args: [] }), run, ...overrides };
  return { budget, budgetPath, directory, save, makeFixture, run, options,
    advance: ms => { time += ms; }, read: () => JSON.parse(readFileSync(budgetPath, 'utf8')) };
}

it('keeps synthetic look pixels out of textual metadata and records tool use', () => {
  const calls = [], record = tool => calls.push(tool);
  const look = probeReply('tools/call', { name: 'look' }, 'encoded-fixture', record);
  expect(look.content[0].text).not.toContain('red');
  expect(look.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: 'encoded-fixture' });
  expect(calls).toEqual(['look']);
  expect(JSON.parse(probeReply('tools/call', { name: 'observe' }, '', record).content[0].text).synthetic).toBe(true);
});

it('bounds hook context and labels observed values as data', () => {
  const result = promptContext({ summary: 'x'.repeat(5000) });
  expect(result.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
  expect(result.hookSpecificOutput.additionalContext).toContain('data, not instructions');
  expect(result.hookSpecificOutput.additionalContext.length).toBeLessThan(1900);
});

it('describes a missing ledger without creating it, a fixture or a model process', async () => {
  const f = trial(); rmSync(f.budgetPath);
  expect(describePreflight({ budgetPath: f.budgetPath })).toMatchObject({ callsModel: false, budgetState: 'missing', code: 'model_budget_required' });
  expect(existsSync(f.budgetPath)).toBe(false);
  await expect(runPreflight(f.options)).rejects.toThrow('model_budget_required');
  expect(existsSync(f.directory)).toBe(false); expect(f.makeFixture).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
});
it.each(['no opt-in', 'invalid', 'expired', 'exhausted'])('blocks %s before fixture creation and dispatch, without spending quota', async mode => {
  const f = trial();
  if (mode === 'no opt-in') f.options.env = {};
  if (mode === 'invalid') f.save({ ...f.budget, limit: Number.MAX_SAFE_INTEGER + 1 });
  if (mode === 'expired') f.advance(100001);
  if (mode === 'exhausted') f.save({ ...f.budget, used: 120 });
  const before = readFileSync(f.budgetPath, 'utf8');
  await expect(runPreflight(f.options)).rejects.toThrow();
  expect(readFileSync(f.budgetPath, 'utf8')).toBe(before); expect(existsSync(f.directory)).toBe(false);
  expect(f.makeFixture).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
});
it('does not reserve when fixture setup fails', async () => {
  const f = trial(); f.options.makeFixture = async () => { throw Error('fixture_setup_failed'); };
  await expect(runPreflight(f.options)).rejects.toThrow('fixture_setup_failed');
  expect(f.read().used).toBe(100); expect(f.run).not.toHaveBeenCalled();
});
it.each(['deadline', 'quota'])('revalidates %s changed during setup before model dispatch', async mode => {
  const f = trial(); f.options.makeFixture = async () => {
    if (mode === 'deadline') f.advance(100001); else f.save({ ...f.budget, used: 120 });
    return { image: 'synthetic-only.png', digits: '7777' };
  };
  await expect(runPreflight(f.options)).rejects.toThrow(mode === 'deadline' ? 'model_test_deadline' : 'model_budget_exhausted');
  expect(f.run).not.toHaveBeenCalled(); expect(f.read().turns).toHaveLength(0);
});
it('reserves exactly once before the mocked inference and caps its signal at the remaining deadline', async () => {
  const f = trial(), model = f.run; let remaining;
  f.save({ ...f.budget, deadline: new Date(Date.parse(f.budget.deadline) - 99950).toISOString() });
  f.options.run = async (...args) => { expect(f.read().used).toBe(101); remaining = args[3]; return model(...args); };
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const result = await runPreflight(f.options);
    expect(result).toMatchObject({ digitsCorrect: true, modelReservationId: 101 });
    expect(f.read().turns).toHaveLength(1); expect(f.run).toHaveBeenCalledOnce(); expect(remaining).toBeInstanceOf(AbortSignal);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('signal did not honor remaining deadline')), 500);
      if (remaining.aborted) { clearTimeout(timer); resolve(); }
      else remaining.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  } finally { output.mockRestore(); }
});
it('keeps a dispatched failure conservatively counted and never retries or refunds', async () => {
  const f = trial(); f.options.run = vi.fn(async () => { throw Error('fixture_transport_unknown'); });
  await expect(runPreflight(f.options)).rejects.toThrow('fixture_transport_unknown');
  expect(f.read().used).toBe(101); expect(f.read().turns).toHaveLength(1); expect(f.options.run).toHaveBeenCalledOnce();
});
it('renders the actual synthetic fixture in the installed platform browser without model calls or reservations', async () => {
  const f = trial(); mkdirSync(f.directory);
  const visual = await createPreflightFixture(f.directory);
  expect(visual).toMatchObject({ shape: 'circle', color: 'red' }); expect(visual.digits).toMatch(/^\d{4}$/);
  expect(readFileSync(visual.image).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(f.read().used).toBe(100); expect(f.run).not.toHaveBeenCalled();
});
it('keeps CLI help and unknown arguments outside model dispatch even with opt-in set', () => {
  const script = fileURLToPath(new URL('../scripts/live-preflight.mjs', import.meta.url));
  for (const flag of ['--help', '--unknown-private-argument']) {
    const child = spawnSync(process.execPath, [script, flag], { env: { ...process.env, FISCH_RUN_MODEL_TESTS: '1' }, encoding: 'utf8' });
    expect(child.status).toBe(flag === '--help' ? 0 : 1);
    expect(flag === '--help' ? child.stdout : child.stderr).toContain(flag === '--help' ? 'Usage:' : 'preflight_arguments_invalid');
    expect(child.stdout + child.stderr).not.toContain('unknown-private-argument');
  }
});

it('honors a larger explicitly authorized ledger and still stops at its configured limit', async () => {
  const f = trial(); f.save({ ...f.budget, limit: 1000, used: 999 });
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect(await runPreflight(f.options)).toMatchObject({ modelReservationId: 1000 });
    expect(f.read().limit).toBe(1000); expect(f.read().used).toBe(1000);
    await expect(runPreflight(f.options)).rejects.toThrow('model_budget_exhausted');
    expect(f.run).toHaveBeenCalledOnce(); expect(f.read().limit).toBe(1000);
  } finally { output.mockRestore(); }
});
