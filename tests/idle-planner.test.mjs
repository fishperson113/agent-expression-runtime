import { expect, it } from 'vitest';
import { ExpressionPlanner } from '../integrations/expression-planner.mjs';
import { InteractionBody } from '../integrations/interaction-body.mjs';
import { normalizeHook } from '../integrations/interaction-events.mjs';

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
it('decays locally, freezes persistent part motion once and breathes without changing silhouette', () => {
  let now = 0, cancelled = 0; const records = [];
  const body = new InteractionBody({ settle() { cancelled++; }, express(record) { records.push(record); } }, () => now);
  body.react({ intensity: 1 }); body.tick('idle');
  const bright = records.at(-1).body.brightness;
  now = 31000; body.tick('idle'); now = 61000; body.tick('idle');
  expect(cancelled).toBe(1); expect(records.at(-1).body.brightness).toBeLessThan(bright);
  expect(records.filter(record => record.body.type === 'assemble')).toHaveLength(0);
  expect(records.some(record => record.body.field === 'pulse')).toBe(true);
});
