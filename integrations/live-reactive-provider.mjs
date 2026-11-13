import { NativeReactionProvider } from './native-reaction-provider.mjs';
import { isAbsolute } from 'node:path';
import { readModelBudget, reserveModelTurn } from './live-model-budget.mjs';
import { reactiveProviderConfig, reactiveResponsesAdapter } from './reactive-provider.mjs';
import { classifierGatedProvider } from './classifier-gated-provider.mjs';
import { prepareNativeUsage } from './native-live-usage.mjs';

export function nativeLiveEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('FISCH_REACTIVE_')));
}
export function createLiveReactiveProvider(env = process.env, { fetch, now = Date.now, classifier, defaultNative = false, usageOptions } = {}) {
  let config;
  try { config = env.FISCH_REACTIVE_BACKEND === 'codex' || defaultNative && env.FISCH_REACTIVE_BACKEND === undefined ? { enabled: true, native: true, model: env.FISCH_REACTIVE_MODEL } : reactiveProviderConfig(env); }
  catch { return { provider: null, reason: 'invalid_provider_config' }; }
  if (!config.enabled) return { provider: null, reason: config.reason };
  const path = env.FISCH_REACTIVE_BUDGET;
  let reserve;
  if (config.native && defaultNative && path === undefined) {
    try { const usage = prepareNativeUsage({ ...usageOptions, env }); reserve = requestId => usage.reserve(requestId, now()); }
    catch { return { provider: null, reason: 'budget_unavailable' }; }
  } else {
    if (typeof path !== 'string' || !path.length) return { provider: null, reason: 'missing_budget' };
    if (!isAbsolute(path)) return { provider: null, reason: 'invalid_budget_path' };
    let budget;
    try { budget = readModelBudget(path); }
    catch { return { provider: null, reason: 'budget_unavailable' }; }
    const at = now();
    if (!Number.isFinite(at) || at >= Date.parse(budget.deadline)) return { provider: null, reason: 'budget_expired' };
    if (budget.used >= budget.limit) return { provider: null, reason: 'budget_exhausted' };
    reserve = requestId => reserveModelTurn(path, (config.native ? 'native-observation:' : 'reactive:') + requestId, now());
  }
  if (config.native) {
    const policy = { deadlineMs: Number(env.FISCH_REACTIVE_DEADLINE_MS ?? 60000), cooldownMs: Number(env.FISCH_REACTIVE_COOLDOWN_MS ?? 15000), maxPerMinute: Number(env.FISCH_REACTIVE_MAX_PER_MINUTE ?? 4) };
    if (!Number.isInteger(policy.deadlineMs) || policy.deadlineMs < 5000 || policy.deadlineMs > 90000 || !Number.isInteger(policy.cooldownMs) || policy.cooldownMs < 1000 || policy.cooldownMs > 60000 || !Number.isInteger(policy.maxPerMinute) || policy.maxPerMinute < 1 || policy.maxPerMinute > 4) return { provider: null, reason: 'invalid_provider_config' };
    const provider = new NativeReactionProvider({ model: config.model, reserve: ({ requestId }) => { reserve(requestId); return true; } }, { env });
    provider.conversationLane = true; provider.contractVersion = 1; provider.policy = Object.freeze(policy);
    return { provider, reason: 'ready_native_conversation' };
  }
  const provider = reactiveResponsesAdapter(config, { fetch, reserve: ({ requestId }) => {
    reserve(requestId); return true;
  } });
  if (classifier !== undefined) {
    try { return { provider: classifierGatedProvider(provider, classifier), reason: 'ready_classifier_gated' }; }
    catch { return { provider: null, reason: 'invalid_classifier_config' }; }
  }
  return { provider, reason: 'ready' };
}
