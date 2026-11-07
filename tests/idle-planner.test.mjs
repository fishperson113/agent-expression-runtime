import { expect, it } from 'vitest';
import { ExpressionPlanner } from '../integrations/expression-planner.mjs';
import { InteractionBody } from '../integrations/interaction-body.mjs';
import { normalizeHook } from '../integrations/interaction-events.mjs';
import { paneActivity } from '../integrations/planner-bridge.mjs';
import { validatePerformance } from '../integrations/expression-plan.mjs';
import { brailleFrame } from '../integrations/pane-display.mjs';

it('preserves thin off-grid pixels when downsampling each Braille dot', () => {
  const pixels = Buffer.alloc(4 * 8 * 3);
  pixels[(1 * 4 + 1) * 3] = 255;
  pixels[(7 * 4 + 3) * 3 + 2] = 255;
  expect(brailleFrame(pixels, 4, 8, 1, 1)).toBe(String.fromCharCode(0x2800 + 1 + 128));
  expect(brailleFrame(pixels, 4, 8, 1, 1, true)).toContain('128;0;128');
});
it('keeps a dot stable as a particle moves inside its sampling footprint', () => {
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const pixels = Buffer.alloc(4 * 8 * 3); pixels[(y * 4 + x) * 3 + 1] = 255;
    expect(brailleFrame(pixels, 4, 8, 1, 1)).toBe('\u2801');
  }
});
it('keeps background blank and preserves the last pixel at noninteger sampling ratios', () => {
  const pixels = Buffer.alloc(5 * 9 * 3, 20);
  expect(brailleFrame(pixels, 5, 9, 1, 1)).toBe(' ');
  pixels[(8 * 5 + 4) * 3] = 255;
  expect(brailleFrame(pixels, 5, 9, 1, 1)).toBe('\u2880');
});

const message = (turn, at) => normalizeHook({ session_id: 's', turn_id: turn, hook_event_name: 'UserPromptSubmit', prompt: 'Hello' }, at);
const task = (turn, at) => normalizeHook({ session_id: 's', turn_id: turn, hook_event_name: 'PostToolUseFailure',
  tool_input: { command: 'npm test' }, tool_use_id: String(at) }, at);
const response = context => ({ eventId: context.event.id, body: { type: 'sequence', children: [{ type: 'parallel',
  children: [{ type: 'morph', target: 'wave', durationMs: 300 }] }] } });
function fixture(plan = async context => response(context)) {
  let now = 0; const calls = [];
  const planner = new ExpressionPlanner({ now: () => now, wallNow: () => now, plan: async context => { calls.push(context); return plan(context); },
    engine: { express() { return { status: 'accepted' }; } } });
  return { planner, calls, async at(time) { now = time; planner.tick(); await planner.job; } };
}
it.each(['idle', 'done'])('never calls an LLM in unchanged %s, even after a full day', async status => {
  const f = fixture();
  try {
    f.planner.update(status);
    for (const time of [0, 12000, 300000, 600000, 3600000, 86400000]) await f.at(time);
    expect(f.calls).toHaveLength(0); expect(f.planner.info.repertoireRotation).toBe(false);
  } finally { f.planner.close(); }
});
it('responds once to a user event during idle, then holds without new inference or replay', async () => {
  const f = fixture();
  try {
    f.planner.update('idle'); f.planner.accept(message('a', 0)); await f.at(0);
    await f.at(300000); await f.at(86400000);
    expect(f.calls).toHaveLength(1); expect(f.planner.info.applied).toBe(1);
  } finally { f.planner.close(); }
});
it('coalesces milestones, dispatches before expiry and caps attempts at two per turn', async () => {
  const f = fixture();
  try {
    f.planner.update('working'); f.planner.accept(message('a', 0)); await f.at(0);
    f.planner.accept(task('a', 2000)); await f.at(2000); expect(f.calls).toHaveLength(1);
    await f.at(10000); expect(f.calls).toHaveLength(2);
    f.planner.accept(task('a', 60000)); await f.at(60000); expect(f.calls).toHaveLength(2);
    f.planner.accept(task('a', 120000)); await f.at(120000); expect(f.calls).toHaveLength(2);
    f.planner.accept(message('b', 120000)); await f.at(120000); expect(f.calls).toHaveLength(3);
  } finally { f.planner.close(); }
});
it('counts failures against the budget and never retries on a timer', async () => {
  const f = fixture(async () => { throw Error('unavailable'); });
  try {
    f.planner.update('working'); f.planner.accept(message('a', 0)); await f.at(0);
    await f.at(60000); expect(f.calls).toHaveLength(1);
    f.planner.accept(task('a', 60000)); await f.at(60000);
    f.planner.accept(task('a', 120000)); await f.at(120000);
    expect(f.calls).toHaveLength(2); expect(f.planner.info.requestsThisTurn).toBe(2);
  } finally { f.planner.close(); }
});
it('drops queued task reactions on idle and never dispatches an old milestone', async () => {
  const f = fixture();
  try {
    f.planner.update('working'); f.planner.accept(message('a', 0)); await f.at(0);
    f.planner.accept(task('a', 2000)); f.planner.update('done'); await f.at(60000);
    expect(f.calls).toHaveLength(1);
  } finally { f.planner.close(); }
});
it('decays locally without cancelling geometry or submitting ambient replacement programs', () => {
  let now = 0, cancelled = 0; const records = [];
  const state = {};
  const body = new InteractionBody({ state, settle() { cancelled++; }, express(record) { records.push(record); } }, () => now);
  body.react({ mood: 'playful', intensity: 1 }); body.tick('idle');
  const bright = records.at(-1).body.brightness;
  now = 31000; body.tick('idle'); now = 61000; body.tick('idle');
  expect(cancelled).toBe(0); expect(records.at(-1).body.brightness).toBeLessThan(bright);
  expect(records.filter(record => record.body.type === 'assemble')).toHaveLength(0);
  expect(records.every(record => record.kind === 'state')).toBe(true);
  expect(state.presenceIntent).toMatchObject({ activity: 'idle', mood: 'playful' });
});
it('keeps local presence after manual expression without resuming inference', () => {
  const state = {}, engine = { state, express: () => ({ status: 'accepted' }), cancel() {} };
  const activity = paneActivity(engine, { agent: 'codex' }, async () => ({}),
    { enabled: false }, { now: () => 1000 });
  try {
    activity.express({ body: { type: 'morph', target: 'sphere', durationMs: 100 } });
    activity.update('idle'); activity.tick();
    expect(state).toMatchObject({ presenceIntent: { activity: 'idle' } });
    expect(activity.planner.attempts).toBe(0);
    expect(activity.source).toBe('manual');
  } finally { activity.close(); }
});

import { PresenceMotion } from '../src/core/runtime/presence.ts';
import { TerminalEngine } from '../src/terminal/runtime.ts';
import { ParticleFormation } from '../src/core/geometry/morph.ts';
import { validateSculpture } from '../src/core/geometry/validate.ts';
import { Scheduler } from '../src/core/runtime/scheduler.ts';

const motionPart = (x = 0, scale = 1) => ({ partId: 'arbitrary', pivot: [0, 0, 0],
  translate: [x, 0, 0], rotate: [0, 0, x], scale: [1, scale, 1] });
const generatedScore = () => ({ clips: [
  { id: 'contrast-a', activity: 'working', gapMs: 2000,
    beats: [{ durationMs: 400, parts: [motionPart(0.4, 0.1)] }, { durationMs: 500, parts: [motionPart(-0.3, 1.5)] }] },
  { id: 'contrast-b', activity: 'working', gapMs: 2000,
    beats: [{ durationMs: 600, parts: [motionPart(-0.4, 0.3)] }, { durationMs: 400, parts: [motionPart(0.2, 1.2)] }] },
  { id: 'quiet', activity: 'idle', gapMs: 4000,
    beats: [{ durationMs: 500, parts: [motionPart(0.1)] }, { durationMs: 500, parts: [motionPart()] }] },
] });

it('plays model-authored articulated working performances over time without immediate repeats', () => {
  const controller = new PresenceMotion(), score = generatedScore(), played = [];
  let lastCount = 0, deformation = 0;
  for (let now = 0; now < 60000; now += 50) {
    const pose = controller.sample(now, { activity: 'working', performance: score });
    if (pose.clipCount !== lastCount) { played.push(pose.clipId); lastCount = pose.clipCount; }
    deformation = Math.max(deformation, ...pose.parts.map(part => Math.abs(part.scale[1] - 1)));
  }
  expect(played.length).toBeGreaterThan(10);
  expect(played.every((id, i) => !i || id !== played[i - 1])).toBe(true);
  expect(deformation).toBeGreaterThan(0.8);
  for (let now = 60000; now < 64000; now += 50) controller.sample(now, { activity: 'idle', performance: score });
  expect(controller.pose.clipId === 'quiet' || controller.pose.clipId === undefined).toBe(true);
});

it('validates generic part bindings, fixed pivots and budgets rather than assuming anatomy', () => {
  const geometry = { children: [{ children: [{ type: 'assemble', parts: [{ id: 'arbitrary' }] }] }] };
  expect(validatePerformance(generatedScore(), geometry).clips).toHaveLength(3);
  const bad = generatedScore(); bad.clips[0].beats[0].parts[0].partId = 'missing';
  expect(() => validatePerformance(bad, geometry)).toThrow('invalid_performance');
  const pivot = generatedScore(); pivot.clips[0].beats[1].parts[0].pivot[0] = 1;
  expect(() => validatePerformance(pivot, geometry)).toThrow('invalid_performance');
  const unsafe = generatedScore(); unsafe.clips[0].beats[0].parts[0].scale[0] = Infinity;
  expect(() => validatePerformance(unsafe, geometry)).toThrow('invalid_performance');
});

it('deforms only explicitly bound parts without mutating base geometry or accumulating offsets', () => {
  const formation = new ParticleFormation(128);
  const shape = validateSculpture({ parts: ['arbitrary', 'untouched'].map((id, i) => ({ id, kind: 'ellipsoid',
    center: [i, 0, 0], scale: [0.2, 0.3, 0.1] })) }, '$');
  formation.sample({}, shape, 1, [1, 0, 0, 0, 0, 0, 0], 42, 0);
  const base = formation.points.slice(), first = formation.perform([motionPart(0.3)]).slice();
  expect(formation.perform([motionPart(0.3)])).toEqual(first);
  expect(formation.points).toEqual(base);
  for (let i = 0; i < 128; i++) if (formation.groups[i] === 1)
    expect(first.slice(i * 3, i * 3 + 3)).toEqual(base.slice(i * 3, i * 3 + 3));
  expect(first).not.toEqual(base);
  formation.freeze(0); formation.tick(500);
  expect(formation.points).toEqual(first);
});

it('holds articulated poses when off and clears a cancelled score', () => {
  const controller = new PresenceMotion(), score = generatedScore();
  for (let now = 0; now <= 350; now += 50) controller.sample(now, { activity: 'working', performance: score });
  const frozen = structuredClone(controller.pose.parts);
  controller.sample(5000, { activity: 'working', mode: 'off', performance: score });
  expect(controller.pose.parts).toEqual(frozen);
  controller.sample(5050, { activity: 'working', performance: null });
  expect(controller.pose.parts).toHaveLength(0);
  const state = {}, body = new InteractionBody({ state, express() {} }, () => 0);
  body.setPerformance(score); body.cue('interrupted');
  expect(state.presenceIntent.performance).toBe(null);
});

it('never installs an old generated performance after a newer user message', async () => {
  let finish;
  const state = {}, engine = { state, express: () => ({ status: 'accepted' }), cancel() {} };
  const activity = paneActivity(engine, {}, async () => ({}), { enabled: true }, {
    plan: context => new Promise(resolve => { finish = () => resolve({ eventId: context.event.id,
      mood: 'focused', intensity: 0.6, target: 'task', concept: 'an invented changing composition',
      body: { type: 'sequence', children: [{ type: 'parallel', children: [{ type: 'assemble', durationMs: 300,
        parts: [{ id: 'arbitrary', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.5, 0.5, 0.1] }] }] }] },
      performance: generatedScore() }); }),
  });
  try {
    activity.update('working'); activity.event(message('old', Date.now())); activity.tick();
    activity.event(message('new', Date.now())); finish();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(state.presenceIntent.performance).toBe(null);
    expect(activity.planner.applied).toBe(0);
  } finally { activity.close(); }
});

it('installs the generated score only after the associated automatic plan is accepted', async () => {
  const state = {}, engine = { state, express: () => ({ status: 'accepted' }), cancel() {} };
  const score = generatedScore();
  const activity = paneActivity(engine, {}, async () => ({}), { enabled: true }, {
    plan: async context => ({ eventId: context.event.id, mood: 'focused', intensity: 0.6, target: 'task',
      concept: 'an invented changing composition', performance: score,
      body: { type: 'sequence', children: [{ type: 'parallel', children: [{ type: 'assemble', durationMs: 300,
        parts: [{ id: 'arbitrary', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.5, 0.5, 0.1] }] }] }] } }),
  });
  try {
    activity.update('working'); activity.event(message('accepted', Date.now())); activity.tick();
    expect(state.presenceIntent.performance).toBe(null);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(activity.planner.applied).toBe(1);
    expect(state.presenceIntent.performance).toBe(score);
  } finally { activity.close(); }
});

it('is deterministic, bounded, continuous and alive beyond a minute of idle', () => {
  const a = new PresenceMotion(42), b = new PresenceMotion(42), samples = [];
  let previous = 0;
  for (let now = 0; now <= 120000; now += 50) {
    const pose = a.sample(now, { activity: 'idle' });
    expect(pose).toEqual(b.sample(now, { activity: 'idle' }));
    expect(Math.abs(pose.roll - previous)).toBeLessThan(0.003);
    expect(Math.abs(pose.x)).toBeLessThan(0.04);
    expect(Object.values(pose).filter(v => typeof v === 'number').every(Number.isFinite)).toBe(true);
    previous = pose.roll;
    if (now >= 60000) samples.push(pose.roll);
  }
  expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.02);
});

it('blends suppression, survives clock gaps and freezes the current ambient pose when off', () => {
  const motion = new PresenceMotion();
  for (let now = 0; now <= 4000; now += 50) motion.sample(now, { activity: 'idle' });
  const before = { ...motion.pose };
  motion.sample(4050, { activity: 'working' }, true);
  expect(Math.abs(motion.pose.roll - before.roll)).toBeLessThan(0.004);
  const frozen = { ...motion.pose };
  motion.sample(900000, { activity: 'idle', mode: 'off' });
  expect(motion.pose.roll).toBe(frozen.roll);
  motion.sample(900050, { activity: 'idle' });
  expect(Math.abs(motion.pose.roll - frozen.roll)).toBeLessThan(0.004);
});

it('reduces ambient amplitude and honors renderer accessibility preference without mutating intent', () => {
  const normal = new PresenceMotion(), reduced = new PresenceMotion();
  for (let now = 0; now <= 4000; now += 50) {
    normal.sample(now, { activity: 'idle' }); reduced.sample(now, { activity: 'idle', mode: 'reduced' });
  }
  expect(reduced.pose.roll).toBeCloseTo(normal.pose.roll * 0.12);
  let now = 0;
  const scheduler = new Scheduler({ now: () => now }, { reducedMotion: true, apply() {}, dispose() {} }, { count() {} });
  scheduler.state.presenceIntent = { activity: 'idle', mode: 'normal' };
  scheduler.tick(); now = 50; scheduler.tick();
  expect(scheduler.state.presencePose?.mode).toBe('reduced');
  expect(scheduler.state.presenceIntent.mode).toBe('normal'); scheduler.dispose();
});

it('keeps formation groups and topology through quiet settling and resumes authored motion', () => {
  const formation = new ParticleFormation(128);
  const sculpture = validateSculpture({ parts: [{ id: 'ear', kind: 'ellipsoid', center: [0, 0, 0],
    scale: [0.2, 0.5, 0.1], motion: { pivot: [0, 0, 0], translate: [0, 0.1, 0],
      rotate: [0, 0, 0.2], periodMs: 2000, phase: 0 } },
    { id: 'body', kind: 'ellipsoid', center: [0, -0.5, 0], scale: [0.4, 0.4, 0.2] }] }, '$');
  formation.sample({}, sculpture, 1, [1, 0, 0, 0, 0, 0, 0], 42, 0);
  const groups = formation.groups.slice(); formation.quiet = true;
  for (let now = 50; now <= 60000; now += 50) formation.tick(now);
  const a = formation.points.slice(); formation.tick(61000);
  expect(formation.groups).toEqual(groups);
  expect(new Set(formation.groups).size).toBe(2);
  expect(Math.max(...formation.points.map((v, i) => Math.abs(v - a[i])))).toBeLessThan(0.00001);
  formation.quiet = false; formation.tick(62000);
  expect(formation.points).not.toEqual(a);
});

it('renders ambient motion without changing semantic geometry and holds render time when off', () => {
  let now = 0; const engine = new TerminalEngine(() => now);
  try {
    engine.state.presenceIntent = { activity: 'idle' };
    const first = Buffer.from(engine.frame(160, 120));
    for (now = 50; now <= 4000; now += 50) engine.frame(160, 120);
    expect(engine.frame(160, 120)).not.toEqual(first);
    expect(engine.state.grow).toBe(1);
    engine.state.presenceIntent.mode = 'off'; engine.frame(160, 120);
    const frozen = Buffer.from(engine.frame(160, 120));
    now += 5000; expect(engine.frame(160, 120)).toEqual(frozen);
  } finally { engine.dispose(); }
});
