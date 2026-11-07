import { expect, it } from 'vitest';
import { ExpressionPlanner } from '../integrations/expression-planner.mjs';
import { paneActivity } from '../integrations/planner-bridge.mjs';

const value = target => ({ body: { type: 'sequence', children: [{ type: 'parallel', children: [
  { type: 'morph', target, durationMs: 800 },
] }] } });
function fixture(status = 'idle', plan) {
  let now = 0, text = ''; const requests = [], admitted = [];
  const planner = new ExpressionPlanner({ now: () => now, readContext: async () => text,
    engine: { express(record) { admitted.push(record.body); return { status: 'accepted' }; } },
    plan: async (context, signal) => {
      requests.push(context); return plan ? plan(context, signal) : value(requests.length === 1 ? 'wave' : 'sphere');
    },
  });
  planner.update(status);
  return { planner, requests, admitted, async at(time) {
    now = time; planner.tick(); await planner.reading; await planner.job;
  }, setTime(time) { now = time; }, setText(value) { text = value; } };
}
it.each(['idle', 'done'])('refreshes ambient planning in %s without needing new terminal text', async status => {
  const f = fixture(status);
  try {
    await f.at(0); expect(f.requests).toHaveLength(0);
    await f.at(299999); expect(f.requests).toHaveLength(0);
    await f.at(302000); expect(f.requests).toHaveLength(1);
    await f.at(604000); expect(f.requests).toHaveLength(2);
    expect(f.requests[1]).toMatchObject({ activity: status, trigger: 'idle_refresh', idleCycle: 2,
      previousPlan: value('wave').body });
    expect(f.planner.info.applied).toBe(2);
    await f.at(3600000); expect(f.requests).toHaveLength(2);
    expect(f.planner.info.idleBudget).toEqual({ used: 2, limit: 2, intervalMs: 300000 });
  } finally { f.planner.close(); }
});
it('replays the current idle expression between model calls and reports it separately', async () => {
  const f = fixture();
  try {
    await f.at(0); await f.at(300000); await f.at(311999); expect(f.admitted).toHaveLength(1);
    await f.at(312000); expect(f.admitted).toHaveLength(2);
    expect(f.requests).toHaveLength(1);
    expect(f.planner.info).toMatchObject({ applied: 1, idleReplays: 1, idleCycles: 1 });
    f.planner.invalidate(); await f.at(900000);
    expect(f.admitted).toHaveLength(2); expect(f.requests).toHaveLength(1);
  } finally { f.planner.close(); }
});
it('does not schedule idle refreshes or replays while working', async () => {
  const f = fixture('working');
  try { await f.at(0); await f.at(120000); expect(f.requests).toHaveLength(0); }
  finally { f.planner.close(); }
});
it('discards late idle inference when work resumes and stops ambient replay', async () => {
  let resolve;
  const f = fixture('idle', () => new Promise(done => { resolve = done; }));
  try {
    await f.at(0); f.setTime(300000); f.planner.tick(); await f.planner.reading;
    f.planner.update('working'); resolve(value('wave')); await f.planner.job;
    f.setTime(420000); f.planner.tick(); await f.planner.reading;
    expect(f.admitted).toHaveLength(0); expect(f.planner.info.discarded).toBe(1);
    expect(f.requests).toHaveLength(1);
  } finally { f.planner.close(); }
});
it('backs off failed idle requests instead of retrying each render frame', async () => {
  const f = fixture('idle', async () => { throw Error('unavailable'); });
  try {
    await f.at(0); await f.at(300000); expect(f.planner.info.mode).toBe('fallback');
    await f.at(302000); await f.at(599000); expect(f.requests).toHaveLength(1);
    await f.at(602000); expect(f.requests).toHaveLength(2);
    await f.at(1200000); expect(f.requests).toHaveLength(2);
  } finally { f.planner.close(); }
});
it('never replays an admitted idle plan after working resumes or the planner closes', async () => {
  const f = fixture();
  await f.at(0); await f.at(300000); expect(f.admitted).toHaveLength(1);
  f.planner.update('working'); await f.at(312000);
  expect(f.admitted).toHaveLength(1); expect(f.planner.info.idleReplays).toBe(0);
  f.planner.update('idle'); f.planner.close(); await f.at(1200000);
  expect(f.admitted).toHaveLength(1); expect(f.requests).toHaveLength(1);
});
it('yields to an explicit manual expression instead of replaying over it', async () => {
  let now = 0; const submitted = [];
  const engine = { cancel() {}, express(args) { submitted.push(args.body); return { status: 'accepted' }; } };
  const activity = paneActivity(engine, {}, async () => ({ read: { text: '' } }), { enabled: false },
    { now: () => now, plan: async () => value('wave') });
  try {
    activity.update('idle'); activity.tick(); now = 300000; activity.tick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(activity.source).toBe('planner');
    activity.express({ body: value('sphere').body }); expect(activity.source).toBe('manual');
    const count = submitted.length; now = 420000; activity.tick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(submitted).toHaveLength(count); expect(activity.planner.idleReplays).toBe(0);
  } finally { activity.close(); }
});
it('preserves idle budget despite terminal noise and idle/done changes, resetting only on work', async () => {
  const f = fixture();
  try {
    await f.at(0); f.setText('new terminal output'); await f.at(2000);
    expect(f.requests).toHaveLength(0);
    f.planner.update('done'); await f.at(300000); expect(f.requests).toHaveLength(1);
    f.setText('another tool result'); f.planner.update('idle'); await f.at(600000);
    expect(f.requests).toHaveLength(2);
    f.planner.update('done'); f.setText('different context again'); await f.at(1200000);
    expect(f.requests).toHaveLength(2);
    f.planner.update('working'); f.setText(''); await f.at(1202000);
    f.planner.update('idle'); await f.at(1204000); expect(f.requests).toHaveLength(2);
    await f.at(1502000); expect(f.requests).toHaveLength(3);
    expect(f.planner.info.idleBudget.used).toBe(1);
  } finally { f.planner.close(); }
});
