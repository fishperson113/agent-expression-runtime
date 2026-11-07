import { expect, it } from 'vitest';
import { ExpressionPlanner } from '../integrations/expression-planner.mjs';
import { normalizeHook } from '../integrations/interaction-events.mjs';
import { paneActivity } from '../integrations/planner-bridge.mjs';
import { TerminalEngine } from '../src/terminal/runtime.ts';

const event = (turn = 'turn', type = 'UserPromptSubmit') => normalizeHook({ session_id: 's', turn_id: turn,
  hook_event_name: type, prompt: 'Cảm ơn bạn!', tool_use_id: turn });
const result = context => ({ eventId: context.event.id, mood: 'warm', intensity: 0.5, target: 'user', concept: 'smile',
  body: { type: 'sequence', children: [{ type: 'parallel', children: [{ type: 'assemble', durationMs: 300,
    parts: [{ id: 'smile', kind: 'curve', points: [[-0.5, 0, 0], [0, -0.3, 0], [0.5, 0, 0]], radius: 0.04 }] }] }] } });
function fixture(plan = async context => result(context), timeoutMs = 1000) {
  const submitted = [], engine = { express(value) { submitted.push(value); return { status: 'accepted' }; } };
  const planner = new ExpressionPlanner({ engine, plan, timeoutMs, requireAssembly: true });
  planner.update('working'); return { planner, submitted };
}
it('plans from the actual user message and never samples terminal context', async () => {
  const f = fixture(async context => {
    expect(context.userMessage).toBe('Cảm ơn bạn!'); expect(context.event.type).toBe('user_message');
    expect(context.visibleContext).toBeUndefined(); return result(context);
  });
  try {
    expect(f.planner.accept(event())).toBe(true); f.planner.tick(); await f.planner.job;
    expect(f.planner.info.applied).toBe(1); expect(f.planner.info.lastReaction.mood).toBe('warm');
    expect(f.submitted).toHaveLength(1);
    for (let i = 0; i < 100; i++) f.planner.tick();
    expect(f.planner.info.attempts).toBe(1);
  } finally { f.planner.close(); }
});
it('rejects duplicates, old turns, other sessions and expired events', () => {
  const f = fixture();
  try {
    const first = event(); expect(f.planner.accept(first)).toBe(true); expect(f.planner.accept(first)).toBe(false);
    expect(f.planner.accept({ ...event('old', 'Stop') })).toBe(false);
    expect(f.planner.accept({ ...event('turn', 'Stop'), sessionId: 'other' })).toBe(false);
    expect(f.planner.accept({ ...event('new'), at: Date.now() - 31000 })).toBe(false);
    expect(f.planner.info.requestsThisTurn).toBe(0);
  } finally { f.planner.close(); }
});
it('discards a late result after a newer user turn even if the model ignores abort', async () => {
  let resolve; const f = fixture(context => new Promise(done => { resolve = () => done(result(context)); }));
  try {
    f.planner.accept(event()); f.planner.tick(); const old = f.planner.job;
    f.planner.accept(event('new')); resolve(); await old;
    expect(f.submitted).toHaveLength(0); expect(f.planner.info.discarded).toBe(1);
  } finally { f.planner.close(); }
});
it('accepts the same turn response after completion without generating an idle follow-up', async () => {
  let resolve; const f = fixture(context => new Promise(done => { resolve = () => done(result(context)); }));
  try {
    f.planner.accept(event()); f.planner.tick(); f.planner.update('done'); resolve(); await f.planner.job;
    expect(f.planner.info.applied).toBe(1); expect(f.planner.info.queued).toBe(false);
    expect(f.planner.info.idleInference).toBe(false);
  } finally { f.planner.close(); }
});
it('keeps local attention intact on timeout, mismatched event, malformed mood or rejected geometry', async () => {
  const cases = [() => new Promise(() => {}), async context => ({ ...result(context), eventId: 'wrong' }),
    async context => ({ ...result(context), mood: 'invalid' }),
    async context => { const value = result(context); value.body.children[0].children[0].parts = []; return value; }];
  const engine = new TerminalEngine();
  try {
    for (const plan of cases) {
      const planner = new ExpressionPlanner({ engine, plan, requireAssembly: true, timeoutMs: 15 });
      planner.accept(event()); planner.tick(); await planner.job;
      expect(planner.info.applied).toBe(0); expect(planner.info.mode).toBe('fallback'); planner.close();
    }
  } finally { engine.dispose(); }
});
it('shows attention before inference finishes and preserves arbitrary model-authored geometry', async () => {
  let resolve, reads = 0; const engine = new TerminalEngine();
  const activity = paneActivity(engine, {}, async () => { reads++; throw Error('no terminal reads'); }, { enabled: true, backend: 'off' },
    { plan: context => new Promise(done => { resolve = () => done(result(context)); }) });
  try {
    activity.update('working'); expect(activity.event(event()).status).toBe('accepted');
    expect(activity.source).toBe('listening'); activity.tick(); expect(reads).toBe(0);
    resolve(); for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(activity.source).toBe('planner'); expect(activity.planner.lastPlan.children[0].children[0].parts[0].id).toBe('smile');
    activity.update('idle'); expect(activity.source).toBe('planner');
  } finally { activity.close(); engine.dispose(); }
});
it('manual control pauses automatic motion until a new prompt and close aborts outstanding work', async () => {
  let aborted; const f = fixture((_, signal) => { aborted = signal; return new Promise(() => {}); });
  try {
    f.planner.accept(event()); f.planner.tick(); f.planner.invalidate();
    expect(aborted.aborted).toBe(true); expect(f.planner.accept(event('turn', 'PermissionRequest'))).toBe(false);
    expect(f.planner.accept(event('new'))).toBe(true); f.planner.close();
    expect(f.planner.accept(event('later'))).toBe(false);
  } finally { f.planner.close(); }
});
it('settles moving geometry without discarding session macros', () => {
  const engine = new TerminalEngine();
  try {
    expect(engine.express({ kind: 'define', body: { name: 'remember', revision: 1, params: {},
      body: { type: 'wait', durationMs: 10 } } }).status).toBe('accepted');
    engine.settle();
    expect(engine.express({ body: { type: 'call', name: 'remember', revision: 1, args: {} } }).status).toBe('accepted');
  } finally { engine.dispose(); }
});
it('keeps a newer needs-user cue from being overwritten by a delayed earlier reaction', async () => {
  let resolve; const f = fixture(context => new Promise(done => { resolve = () => done(result(context)); }));
  try {
    f.planner.accept(event()); f.planner.tick();
    expect(f.planner.accept(event('turn', 'PermissionRequest'))).toBe(true);
    resolve(); await f.planner.job;
    expect(f.submitted).toHaveLength(0); expect(f.planner.info.discarded).toBe(1);
  } finally { f.planner.close(); }
});
