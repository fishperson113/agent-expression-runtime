import { activityHook } from './agent-hooks.mjs';
import { ExpressionPlanner } from './expression-planner.mjs';
import { plannerConfig, modelPlanner } from './planner-provider.mjs';
import { processPlanner } from './planner-process.mjs';

export function paneActivity(engine, agent, call, config = plannerConfig(undefined, undefined, agent), { plan, now } = {}) {
  const reflex = activityHook(engine);
  let source = 'reflex';
  const native = ['codex', 'claude'].includes(config.backend);
  const planner = new ExpressionPlanner({ engine, now, plan: plan ?? (native ? processPlanner(config) : modelPlanner(config)), reason: config.reason,
    timeoutMs: native ? 20000 : 4000, intervalMs: native ? 30000 : 10000, debounceMs: native ? 2000 : 0,
    onApplied: () => { source = 'planner'; },
    readContext: async () => {
      const result = await call('pane.read', { pane_id: agent.pane_id, source: 'recent_unwrapped', lines: 32, format: 'text' });
      return result.read?.text ?? result.text ?? '';
    },
  });
  return {
    update(status) {
      if (status !== reflex.status) { planner.update(status); engine.cancel(); source = 'reflex'; }
      return reflex.update(status);
    },
    tick() { planner.tick(); },
    cancel() { planner.invalidate(); source = 'cancelled'; return engine.cancel(); },
    close() { planner.close(); },
    get status() { return reflex.status; },
    get source() { return source; },
    get transitions() { return reflex.transitions; },
    get planner() { return { ...planner.info, backend: config.backend }; },
  };
}
