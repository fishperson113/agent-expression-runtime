import { freezeReactiveWindow } from './reactive-window.mjs';

export const classifierLabels = Object.freeze(['observe', 'attend', 'acknowledge', 'playful', 'abstain']);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function parseClassifierPrediction(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 4096) throw Error('classifier_prediction_size');
  let value;
  try { value = JSON.parse(text); } catch { throw Error('classifier_prediction_json'); }
  if (!exact(value, ['schemaVersion', 'label', 'scores']) || value.schemaVersion !== 1 ||
      !classifierLabels.includes(value.label) || !exact(value.scores, classifierLabels) ||
      !Object.values(value.scores).every(unit) || Math.abs(Object.values(value.scores).reduce((a, b) => a + b, 0) - 1) > 0.00001)
    throw Error('classifier_prediction_invalid');
  const best = Math.max(...Object.values(value.scores));
  if (value.scores[value.label] !== best) throw Error('classifier_prediction_label');
  return freeze(value);
}
function configuration({ modelId, modelRevision, minConfidence, minMargin, capacity = 256, now, isCurrent }) {
  if (![modelId, modelRevision].every(value => typeof value === 'string' && /^[A-Za-z0-9_./-]{1,128}$/.test(value)) ||
      !unit(minConfidence) || !unit(minMargin) || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 256 ||
      typeof now !== 'function' || typeof isCurrent !== 'function') throw Error('classifier_configuration_invalid');
  return Object.freeze({ modelId, modelRevision, minConfidence, minMargin, capacity, now, isCurrent });
}
export class ClassifierShadowAdapter {
  #config; #bindings = new Map();
  constructor(options) { this.#config = configuration(options); }
  bind(value) {
    const window = freezeReactiveWindow(value), request = window.request, key = `${request.sessionId}:${request.epoch}:${request.requestId}`;
    if (this.#bindings.has(key)) throw Error('classifier_binding_duplicate');
    if (this.#bindings.size >= this.#config.capacity) throw Error('classifier_binding_capacity');
    const binding = freeze({ key, request, modelId: this.#config.modelId, modelRevision: this.#config.modelRevision });
    this.#bindings.set(key, { binding, completed: false });
    return binding;
  }
  complete(binding, text) {
    const entry = this.#bindings.get(binding?.key);
    if (!entry || entry.binding !== binding || entry.completed) return Object.freeze({ status: 'dropped', reason: 'binding_unknown_or_completed' });
    entry.completed = true;
    let prediction;
    try { prediction = parseClassifierPrediction(text); } catch { return Object.freeze({ status: 'dropped', reason: 'prediction_invalid' }); }
    let now;
    try { now = this.#config.now(); } catch { return Object.freeze({ status: 'dropped', reason: 'clock_failed' }); }
    if (!Number.isFinite(now) || now >= binding.request.deadline) return Object.freeze({ status: 'dropped', reason: 'deadline' });
    let current = false;
    try { current = this.#config.isCurrent(binding) === true; } catch { /* Host validation failure is closed. */ }
    if (!current) return Object.freeze({ status: 'dropped', reason: 'host_revoked' });
    const scores = Object.values(prediction.scores).sort((a, b) => b - a), uncertain =
      scores[0] < this.#config.minConfidence || scores[0] - scores[1] < this.#config.minMargin;
    return freeze({ status: 'shadow', binding, label: uncertain ? 'abstain' : prediction.label,
      reason: uncertain ? 'uncertain' : prediction.label === 'abstain' ? 'model_abstain' : 'model_choice', scores: prediction.scores });
  }
  clear() { this.#bindings.clear(); }
  get retainedCount() { return this.#bindings.size; }
}
