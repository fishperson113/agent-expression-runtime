import { isAbsolute } from 'node:path';
import { readModelBudget, reserveModelTurn } from './live-model-budget.mjs';
import { reactiveProviderConfig, reactiveResponsesAdapter } from './reactive-provider.mjs';

export function nativeLiveEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('FISCH_REACTIVE_')));
}
export function createLiveReactiveProvider(env = process.env, { fetch, now = Date.now } = {}) {
  let config;
  try { config = reactiveProviderConfig(env); }
  catch { return { provider: null, reason: 'invalid_provider_config' }; }
  if (!config.enabled) return { provider: null, reason: config.reason };
  const path = env.FISCH_REACTIVE_BUDGET;
  if (typeof path !== 'string' || !path.length) return { provider: null, reason: 'missing_budget' };
  if (!isAbsolute(path)) return { provider: null, reason: 'invalid_budget_path' };
  let budget;
  try { budget = readModelBudget(path); }
  catch { return { provider: null, reason: 'budget_unavailable' }; }
  const at = now();
  if (!Number.isFinite(at) || at >= Date.parse(budget.deadline)) return { provider: null, reason: 'budget_expired' };
  if (budget.used >= budget.limit) return { provider: null, reason: 'budget_exhausted' };
  const provider = reactiveResponsesAdapter(config, { fetch, reserve: ({ requestId }) => {
    reserveModelTurn(path, 'reactive:' + requestId, now()); return true;
  } });
  return { provider, reason: 'ready' };
}
