import { activityHook } from './agent-hooks.mjs';
import { ExpressionPlanner } from './expression-planner.mjs';
import { plannerConfig, modelPlanner } from './planner-provider.mjs';
import { processPlanner } from './planner-process.mjs';

export function paneActivity(engine, agent, call, config = plannerConfig(undefined, undefined, agent)) {
  const reflex = activityHook(engine);
  const native = ['codex', 'claude'].includes(config.backend);
  const planner = new ExpressionPlanner({ engine, plan: native ? processPlanner(config) : modelPlanner(config), reason: config.reason,
    timeoutMs: native ? 20000 : 4000, intervalMs: native ? 30000 : 10000,
    readContext: async () => {
      const result = await call('pane.read', { pane_id: agent.pane_id, source: 'recent_unwrapped', lines: 32, format: 'text' });
      return result.read?.text ?? result.text ?? '';
    },
  });
  return {
    update(status) {
      if (status !== reflex.status) { planner.update(status); engine.cancel(); }
      return reflex.update(status);
    },
    tick() { planner.tick(); },
    cancel() { planner.invalidate(); return engine.cancel(); },
    close() { planner.close(); },
    get status() { return reflex.status; },
    get transitions() { return reflex.transitions; },
    get planner() { return { ...planner.info, backend: config.backend }; },
  };
}
