import { expect, it } from 'vitest';
import { ExpressionPlanner } from '../integrations/expression-planner.mjs';
import { paneActivity } from '../integrations/planner-bridge.mjs';

const value = target => ({ body: { type: 'sequence', children: [{ type: 'parallel', children: [
  { type: 'morph', target, durationMs: 800 },
] }] } });
function fixture(status = 'idle', plan) {
  let now = 0; const requests = [], admitted = [];
  const planner = new ExpressionPlanner({ now: () => now, readContext: async () => '',
    engine: { express(record) { admitted.push(record.body); return { status: 'accepted' }; } },
    plan: async (context, signal) => {
      requests.push(context); return plan ? plan(context, signal) : value(requests.length === 1 ? 'wave' : 'sphere');
    },
  });
  planner.update(status);
  return { planner, requests, admitted, async at(time) {
    now = time; planner.tick(); await planner.reading; await planner.job;
  }, setTime(time) { now = time; } };
}
it.each(['idle', 'done'])('refreshes ambient planning in %s without needing new terminal text', async status => {
  const f = fixture(status);
  try {
    await f.at(0); expect(f.requests).toHaveLength(1);
    await f.at(59999); expect(f.requests).toHaveLength(1);
    await f.at(62000); expect(f.requests).toHaveLength(2);
    expect(f.requests[1]).toMatchObject({ activity: status, trigger: 'idle_refresh', idleCycle: 1,
      previousPlan: value('wave').body });
    expect(f.planner.info.applied).toBe(2);
  } finally { f.planner.close(); }
});
it('replays the current idle expression between model calls and reports it separately', async () => {
  const f = fixture();
  try {
    await f.at(0); await f.at(11999); expect(f.admitted).toHaveLength(1);
    await f.at(12000); expect(f.admitted).toHaveLength(2);
    expect(f.requests).toHaveLength(1);
    expect(f.planner.info).toMatchObject({ applied: 1, idleReplays: 1, idleCycles: 0 });
    f.planner.invalidate(); await f.at(90000);
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
    f.planner.tick(); await f.planner.reading;
    f.planner.update('working'); resolve(value('wave')); await f.planner.job;
    f.setTime(120000); f.planner.tick(); await f.planner.reading;
    expect(f.admitted).toHaveLength(0); expect(f.planner.info.discarded).toBe(1);
    expect(f.requests).toHaveLength(1);
  } finally { f.planner.close(); }
});
it('backs off failed idle requests instead of retrying each render frame', async () => {
  const f = fixture('idle', async () => { throw Error('unavailable'); });
  try {
    await f.at(0); expect(f.planner.info.mode).toBe('fallback');
    await f.at(2000); await f.at(59000); expect(f.requests).toHaveLength(1);
    await f.at(62000); expect(f.requests).toHaveLength(2);
  } finally { f.planner.close(); }
});
it('never replays an admitted idle plan after working resumes or the planner closes', async () => {
  const f = fixture();
  await f.at(0); expect(f.admitted).toHaveLength(1);
  f.planner.update('working'); await f.at(12000);
  expect(f.admitted).toHaveLength(1); expect(f.planner.info.idleReplays).toBe(0);
  f.planner.update('idle'); f.planner.close(); await f.at(120000);
  expect(f.admitted).toHaveLength(1); expect(f.requests).toHaveLength(1);
});
it('yields to an explicit manual expression instead of replaying over it', async () => {
  let now = 0; const submitted = [];
  const engine = { cancel() {}, express(args) { submitted.push(args.body); return { status: 'accepted' }; } };
  const activity = paneActivity(engine, {}, async () => ({ read: { text: '' } }), { enabled: false },
    { now: () => now, plan: async () => value('wave') });
  try {
    activity.update('idle'); activity.tick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(activity.source).toBe('planner');
    activity.express({ body: value('sphere').body }); expect(activity.source).toBe('manual');
    const count = submitted.length; now = 120000; activity.tick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(submitted).toHaveLength(count); expect(activity.planner.idleReplays).toBe(0);
  } finally { activity.close(); }
});
