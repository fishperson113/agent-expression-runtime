import { expect, it } from 'vitest';
import { ExpressionPlanner, cleanContext, contextChange } from '../integrations/expression-planner.mjs';
import { terminalEngine } from '../scripts/pane-session.mjs';
import { paneActivity } from '../integrations/planner-bridge.mjs';
import { TerminalEngine } from '../src/terminal/runtime.ts';

const planValue = target => ({ body: { type: 'sequence', children: [{ type: 'parallel', children: [
  { type: 'morph', target, durationMs: 200 },
] }] } });
it('filters progress counters and small log additions without hiding a substantially different context', () => {
  const baseline = 'Inspect compiler scheduler renderer geometry tests integration validation pipeline';
  expect(contextChange(baseline + ' progress 10', baseline + ' progress 99')).toBe(0);
  expect(contextChange('10 / 100', '99 / 100')).toBe(0);
  expect(contextChange(baseline, baseline + ' completed')).toBeLessThan(0.35);
  expect(contextChange(baseline, 'Người dùng muốn tạo bàn tay peace sign vui vẻ')).toBeGreaterThan(0.35);
});
it('spaces working inference by a minute and requires cumulative context novelty', async () => {
  let now = 0, text = 'Inspect compiler scheduler renderer geometry tests integration validation pipeline', calls = 0;
  const activity = paneActivity({ cancel() {}, express() { return { status: 'accepted' }; } }, {},
    async () => ({ read: { text } }), { enabled: false },
    { now: () => now, plan: async () => { calls++; return planValue('wave'); } });
  const tick = async time => { now = time; activity.tick(); for (let i = 0; i < 10; i++) await Promise.resolve(); };
  try {
    activity.update('working'); await tick(0); expect(calls).toBe(1);
    text += ' completed'; await tick(60000); expect(calls).toBe(1);
    text = 'User requests a joyful bird spreading wings above a little nest';
    await tick(62000); expect(calls).toBe(2);
    text = 'Unexpected network outage prevents authentication and requires user intervention';
    await tick(64000); expect(calls).toBe(2);
    await tick(122000); expect(calls).toBe(3);
  } finally { activity.close(); }
});
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
it('coalesces terminal updates without discarding same-turn inference', async () => {
  let now = 0, text = 'old request', resolve, reflexes = 0; const submitted = [];
  const planner = new ExpressionPlanner({ now: () => now, readContext: async () => text,
    onContextChange() { reflexes++; },
    engine: { express(value) { submitted.push(value); return { status: 'accepted' }; } },
    plan: () => new Promise(done => { resolve = done; }) });
  planner.update('working'); planner.tick(); await planner.reading;
  const oldJob = planner.job; text = 'latest tool output'; now = 2001;
  planner.tick(); await planner.reading; resolve(planValue('cloud')); await oldJob;
  expect(submitted).toHaveLength(1); expect(reflexes).toBe(2); expect(planner.info.discarded).toBe(0);
  expect(planner.info.queued).toBe(true); planner.close();
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
it('lets an admitted plan finish across terminal updates, but preempts it on a real status change', async () => {
  let now = 0, text = 'exploring the request', cancelled = 0; const admitted = [];
  const runtime = new TerminalEngine(() => now);
  const engine = { cancel() { cancelled++; return runtime.cancel(); },
    express(value) { admitted.push(value.body); return runtime.express(value); } };
  const activity = paneActivity(engine, { pane_id: 'agent' }, async () => ({ read: { text } }), { enabled: false },
    { now: () => now, plan: async () => planValue('wave') });
  try {
    activity.update('working'); activity.tick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(activity.source).toBe('planner');
    expect(activity.planner.lastPlan).toEqual(planValue('wave').body);
    expect(activity.planner.lastAppliedAt).toBeTruthy();
    const count = admitted.length, resets = cancelled;
    text = 'terminal received more tool output'; now = 2001; activity.tick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    runtime.frame(64, 64); expect(runtime.state.shape).toBe('wave');
    expect(admitted.length).toBe(count); expect(cancelled).toBe(resets);
    expect(activity.source).toBe('planner');
    activity.update('blocked'); expect(activity.source).toBe('reflex');
    expect(cancelled).toBe(resets + 1);
    expect(admitted.at(-1).children[0].target).toBe('wall');
    now += 700; runtime.frame(64, 64); expect(runtime.state.shape).toBe('wall');
  } finally { activity.close(); runtime.dispose(); }
});
