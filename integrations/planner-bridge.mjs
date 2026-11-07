import { ExpressionPlanner } from './expression-planner.mjs';
import { plannerConfig, modelPlanner } from './planner-provider.mjs';
import { processPlanner } from './planner-process.mjs';
import { warmCodexPlanner } from './planner-codex.mjs';
import { InteractionBody, attentionBody } from './interaction-body.mjs';

export function paneActivity(engine, agent, call, config = plannerConfig(undefined, undefined, agent), { plan, now } = {}) {
  let source = 'ambient', status, transitions = 0, received = 0;
  const native = ['codex', 'claude'].includes(config.backend), body = new InteractionBody(engine, now);
  const inference = config.backend === 'codex' ? warmCodexPlanner(config) : native ? processPlanner(config) : modelPlanner(config);
  const planner = new ExpressionPlanner({ engine, now, plan: plan ?? inference, reason: config.reason,
    requireAssembly: !!config.enabled, timeoutMs: native ? 45000 : 4000,
    onApplied: (_, reaction) => { source = 'planner'; body.react(reaction); } });
  engine.express({ body: attentionBody() });
  return {
    update(next) {
      if (next === status) return false;
      if (next === 'blocked' && !planner.paused) body.cue('needs_user');
      planner.update(next); status = next; transitions++; return true;
    },
    event(event) {
      if (!planner.accept(event)) return { status: 'ignored' };
      received++; body.cue(event.type);
      if (event.type === 'user_message') source = 'listening';
      else if (event.type === 'needs_user' || event.type === 'interrupted') source = 'reflex';
      return { status: 'accepted', eventId: event.id };
    },
    tick() { planner.tick(); if (!planner.paused) body.tick(status); },
    express(args) {
      const result = engine.express(args);
      if (result.status === 'accepted' && args.kind !== 'define') { planner.invalidate(); body.releaseAttention(); source = 'manual'; }
      return result;
    },
    cancel() { planner.invalidate(); body.releaseAttention(); source = 'cancelled'; return engine.cancel(); },
    close() { planner.close(); },
    get status() { return status; },
    get source() { return source; },
    get transitions() { return transitions; },
    get planner() { return { ...planner.info, backend: config.backend, interactionEvents: received,
      eventSource: received ? 'agent-hooks' : 'awaiting-agent-hooks' }; },
  };
}
