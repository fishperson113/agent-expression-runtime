import { ExpressionPlanner } from './expression-planner.mjs';
import { plannerConfig, modelPlanner } from './planner-provider.mjs';
import { processPlanner } from './planner-process.mjs';
import { warmCodexPlanner } from './planner-codex.mjs';
import { InteractionBody, attentionBody } from './interaction-body.mjs';
import { validatePerformance, validateIdleScenes } from './expression-plan.mjs';

function manualExpression(engine, planner, body, args) {
  const score = validatePerformance(args.performance, args.body), scenes = validateIdleScenes(args.idleScenes);
  if (scenes.length && (args.kind && args.kind !== 'program' || args.body?.type !== 'sequence')) throw Error('invalid_idle_scenes');
  const { performance, idleScenes, ...command } = args;
  const result = engine.express(command);
  if (result.status === 'accepted' && args.kind !== 'define') {
    planner.invalidate(); body.releaseAttention(); body.idle.clear(false); body.setPerformance(score);
    body.idle.install(args.body, score, scenes);
  }
  return result;
}

function performancePlanner(plan, body) {
  if (!plan) return null;
  const wrapped = async (context, signal) => {
    const value = await plan({ ...context, presentation: { medium: 'braille',
      emphasis: 'large silhouette changes, articulated poses, readable holds' } }, signal);
    body.remember(value); return value;
  };
  wrapped.close = () => plan.close?.(); wrapped.transport = () => plan.transport?.();
  return wrapped;
}

export function paneActivity(engine, agent, call, config = plannerConfig(undefined, undefined, agent), { plan, now } = {}) {
  let source = 'ambient', status, transitions = 0, received = 0;
  const native = ['codex', 'claude'].includes(config.backend), body = new InteractionBody(engine, now);
  const inference = config.backend === 'codex' ? warmCodexPlanner(config) : native ? processPlanner(config) : modelPlanner(config);
  const planner = new ExpressionPlanner({ engine, now, plan: performancePlanner(plan ?? inference, body), reason: config.reason,
    requireAssembly: !!config.enabled, timeoutMs: native ? 45000 : 4000,
    onApplied: (geometry, reaction) => { source = 'planner'; body.react(reaction, geometry); } });
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
    tick() { planner.tick(); body.tick(status, !planner.paused); },
    express(args) {
      const result = manualExpression(engine, planner, body, args);
      if (result.status === 'accepted' && args.kind !== 'define') source = 'manual';
      return result;
    },
    cancel() {
      planner.invalidate(); body.releaseAttention(); source = 'cancelled';
      const result = engine.cancel(); body.idle.clear(false); body.setPerformance(null); return result;
    },
    close() { planner.close(); },
    get status() { return status; },
    get source() { return body.idle.active ? 'idle-scene' : source; },
    get transitions() { return transitions; },
    get planner() { return { ...planner.info, backend: config.backend, interactionEvents: received,
      ambient: engine.state?.presencePose, idleScenes: body.idle.info,
      eventSource: received ? 'agent-hooks' : 'awaiting-agent-hooks' }; },
  };
}
