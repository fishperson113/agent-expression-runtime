import { createHash } from 'node:crypto';
import { freezeReactiveWindow } from './reactive-window.mjs';
import { parseClassifierPrediction } from './classifier-shadow.mjs';
import { ReactiveProviderError } from './reactive-provider.mjs';

const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function configuration(value) {
  if (!value || typeof value.classify !== 'function' ||
      ![value.modelId, value.modelRevision].every(item => typeof item === 'string' && /^[A-Za-z0-9_./-]{1,128}$/.test(item)) ||
      !unit(value.minConfidence) || !unit(value.minMargin) ||
      (value.now !== undefined && typeof value.now !== 'function') ||
      (value.onClassification !== undefined && typeof value.onClassification !== 'function')) throw Error('classifier_gate_config');
  return Object.freeze({ ...value, now: value.now ?? (() => performance.now()) });
}
function observe(request) {
  const digest = createHash('sha256').update(`${request.sessionId}:${request.epoch}:${request.requestId}`).digest('hex').slice(0, 32);
  return Object.freeze({ schemaVersion: request.schemaVersion, requestId: request.requestId, decisionId: `classifier_${digest}`,
    mode: 'observe', validUntil: request.deadline, action: null, ...(request.schemaVersion === 2 ? { prerequisites: [] } : {}) });
}
function classify(text, config) {
  const prediction = parseClassifierPrediction(text), scores = Object.values(prediction.scores).sort((a, b) => b - a);
  return scores[0] < config.minConfidence || scores[0] - scores[1] < config.minMargin ? 'abstain' : prediction.label;
}
function report(config, request, label, reason) {
  try { config.onClassification?.(Object.freeze({ requestId: request.requestId, modelId: config.modelId,
    modelRevision: config.modelRevision, label, reason })); } catch { /* Observability cannot grant authority. */ }
}
function available(config, request, signal) {
  if (signal?.aborted) throw new ReactiveProviderError('reactive_aborted', true);
  let now;
  try { now = config.now(); } catch { throw new ReactiveProviderError('classifier_clock_invalid', true); }
  if (!Number.isFinite(now) || now < 0) throw new ReactiveProviderError('classifier_clock_invalid', true);
  if (now >= request.deadline) throw new ReactiveProviderError('classifier_deadline', true);
}
export function classifierGatedProvider(provider, options) {
  if (!provider || typeof provider.decide !== 'function' || ![1, 2].includes(provider.contractVersion)) throw Error('classifier_gate_provider');
  const config = configuration(options), seen = new Set(); let active = false;
  const adapter = { async decide(window, signal, onReceipt) {
    const frozen = freezeReactiveWindow(window), request = frozen.request, key = `${request.sessionId}:${request.epoch}:${request.requestId}`;
    if (request.schemaVersion !== provider.contractVersion) throw new ReactiveProviderError('reactive_contract_mismatch', true);
    available(config, request, signal);
    if (active || seen.has(key) || seen.size >= 256) throw new ReactiveProviderError('classifier_gate_capacity', true);
    seen.add(key); active = true;
    try {
      let label = 'abstain', reason = 'classifier_failed';
      try { label = classify(await config.classify(frozen, signal), config); reason = 'classifier_choice'; } catch { /* Fail closed without semantic fallback. */ }
      available(config, request, signal); report(config, request, label, reason);
      available(config, request, signal);
      if (['observe', 'abstain'].includes(label)) return observe(request);
      const transport = { ...frozen, observations: frozen.observations.map(value => ({ ...value, summary: '' })) };
      const decision = await provider.decide(transport, signal, onReceipt);
      available(config, request, signal); return decision;
    } finally { active = false; }
  } };
  return Object.defineProperty(adapter, 'contractVersion', { value: provider.contractVersion });
}
