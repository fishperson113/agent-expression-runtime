import { activityHook } from './agent-hooks.mjs';
import { ExpressionPlanner } from './expression-planner.mjs';
import { plannerConfig, modelPlanner } from './planner-provider.mjs';
import { processPlanner } from './planner-process.mjs';
import { warmCodexPlanner } from './planner-codex.mjs';

export function paneActivity(engine, agent, call, config = plannerConfig(undefined, undefined, agent), { plan, now } = {}) {
  const reflex = activityHook(engine);
  let source = 'reflex', status, transitions = 0;
  const native = ['codex', 'claude'].includes(config.backend);
  const inference = config.backend === 'codex' ? warmCodexPlanner(config) : native ? processPlanner(config) : modelPlanner(config);
  const planner = new ExpressionPlanner({ engine, now, plan: plan ?? inference, reason: config.reason,
    cachePath: config.cachePath, requireAssembly: !!config.enabled,
    timeoutMs: native ? 45000 : 4000, intervalMs: 60000, debounceMs: native ? 750 : 0,
    onApplied: (_, origin = 'planner') => { source = origin; },
    readContext: async () => {
      const result = await call('pane.read', { pane_id: agent.pane_id, source: 'recent_unwrapped', lines: 32, format: 'text' });
      return result.read?.text ?? result.text ?? '';
    },
  });
  return {
    update(next) {
      if (next === status) return false;
      planner.update(next); status = next; transitions++;
      if (planner.pool.entries.length) {
        engine.express({ kind: 'state', body: { brightness: ['idle', 'done'].includes(next) ? 0.72 : 0.88, durationMs: 350 } });
        if (!planner.lastPlan) planner.reuse(); return true;
      }
      engine.cancel(); source = 'reflex'; return reflex.update(next);
    },
    tick() { planner.tick(); },
    express(args) {
      const result = engine.express(args);
      if (result.status === 'accepted' && args.kind !== 'define') { planner.invalidate(); source = 'manual'; }
      return result;
    },
    cancel() { planner.invalidate(); source = 'cancelled'; return engine.cancel(); },
    close() { planner.close(); },
    get status() { return status; },
    get source() { return source; },
    get transitions() { return transitions; },
    get planner() { return { ...planner.info, backend: config.backend }; },
  };
}
