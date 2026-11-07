import { expect, it } from 'vitest';
import { ExpressionPlanner, cleanContext } from '../integrations/expression-planner.mjs';
import { terminalEngine } from '../scripts/pane-session.mjs';
import { paneActivity } from '../integrations/planner-bridge.mjs';

const planValue = target => ({ body: { type: 'sequence', children: [{ type: 'parallel', children: [
  { type: 'morph', target, durationMs: 200 },
] }] } });
it('plans from bounded context and throttles unchanged context without blocking reflexes', async () => {
  let now = 0, text = 'User asks to explore an idea', calls = 0;
  const engine = await terminalEngine();
  const planner = new ExpressionPlanner({ engine, now: () => now, readContext: async () => text,
    plan: async context => { calls++; expect(context.activity).toBe('working'); return planValue('wave'); } });
  try {
    planner.update('working'); planner.tick(); await planner.reading; await planner.job;
    expect(planner.info.applied).toBe(1);
    now = 10001; planner.tick(); await planner.reading; await planner.job; expect(calls).toBe(1);
    text = 'Agent found a concrete solution'; now += 2001;
    planner.tick(); await planner.reading; await planner.job; expect(calls).toBe(2);
    expect(planner.info.applied).toBe(2);
  } finally { planner.close(); engine.dispose(); }
});
it('discards an old plan after interruption even when the model ignores abort', async () => {
  let resolve; const submitted = [];
  const planner = new ExpressionPlanner({ engine: { express(value) { submitted.push(value); return { status: 'accepted' }; } },
    readContext: async () => 'old topic', plan: (_, signal) => new Promise(done => { resolve = done; expect(signal.aborted).toBe(false); }) });
  planner.update('working'); planner.tick(); await Promise.resolve(); await Promise.resolve();
  planner.update('blocked'); resolve(planValue('cloud')); await planner.reading; await planner.job;
  expect(submitted).toEqual([]); expect(planner.info.discarded).toBe(1); planner.close();
});
it('keeps the reflex body on timeout, malformed plans and compiler rejection', async () => {
  const engine = await terminalEngine();
  const cases = [async () => new Promise(() => {}), async () => ({ body: { type: 'call' } }),
    async () => planValue('nonexistent')];
  try {
    for (const plan of cases) {
      const planner = new ExpressionPlanner({ engine, readContext: async () => 'context', plan, timeoutMs: 15 });
      planner.update('working'); planner.tick(); await planner.reading; await planner.job;
      expect(planner.info.mode).toBe('fallback'); expect(planner.info.applied).toBe(0); planner.close();
    }
  } finally { engine.dispose(); }
});
it('never reads context without configuration and cancels pending work on close', async () => {
  const engine = await terminalEngine(); let reads = 0;
  const activity = paneActivity(engine, { pane_id: 'selected' }, async () => { reads++; }, { enabled: false, reason: 'missing_model_or_endpoint' });
  try {
    expect(activity.update('working')).toBe(true); activity.tick();
    expect(activity.planner.mode).toBe('disabled'); expect(reads).toBe(0);
    activity.cancel(); activity.close(); activity.tick(); expect(reads).toBe(0);
  } finally { engine.dispose(); }
});
it('bounds and redacts common credentials from context', () => {
  const text = cleanContext('x'.repeat(7000) + '\x1b[31m key sk-abcdefghijklmnopqrstuvwxyz token=private password=abc');
  expect(text.length).toBeLessThanOrEqual(6000);
  expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz'); expect(text).not.toContain('private');
  expect(text).not.toContain('\x1b');
  expect(cleanContext('context\n• Working (10m 01s • esc to interrupt) · 1 background terminal running'))
    .toBe(cleanContext('context\n• Working (10m 02s • esc to interrupt) · 1 background terminal running'));
});
it('invalidates in-flight work when context changes within the same working status', async () => {
  let now = 0, text = 'old request', resolve, reflexes = 0; const submitted = [];
  const planner = new ExpressionPlanner({ now: () => now, readContext: async () => text,
    onContextChange() { reflexes++; },
    engine: { express(value) { submitted.push(value); return { status: 'accepted' }; } },
    plan: () => new Promise(done => { resolve = done; }) });
  planner.update('working'); planner.tick(); await planner.reading;
  const oldJob = planner.job; text = 'new user topic'; now = 2001;
  planner.tick(); await planner.reading; resolve(planValue('cloud')); await oldJob;
  expect(submitted).toEqual([]); expect(reflexes).toBe(2); expect(planner.info.discarded).toBe(1); planner.close();
});
it('waits for a quiet context window before starting a native process', async () => {
  let now = 0, text = 'streaming', calls = 0;
  const planner = new ExpressionPlanner({ now: () => now, debounceMs: 2000, readContext: async () => text,
    engine: { express() { return { status: 'accepted' }; } }, plan: async () => { calls++; return planValue('wave'); } });
  planner.update('working'); planner.tick(); await planner.reading; expect(calls).toBe(0);
  text = 'stable'; now = 2000; planner.tick(); await planner.reading; expect(calls).toBe(0);
  now = 4000; planner.tick(); await planner.reading; await planner.job;
  expect(calls).toBe(1); expect(planner.info.applied).toBe(1); planner.close();
});
