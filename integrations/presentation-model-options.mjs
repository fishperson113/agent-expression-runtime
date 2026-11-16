// Syntax only: the native model catalog remains the authority for supported pairs.
export function visualModelOptions(visualModel, visualEffort) {
  if (visualModel === undefined && visualEffort === undefined) return {};
  if (typeof visualModel !== 'string' || visualModel.trim() !== visualModel || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(visualModel)
    || typeof visualEffort !== 'string' || visualEffort.trim() !== visualEffort || !/^[a-z][a-z0-9_-]{0,31}$/.test(visualEffort)) throw Error('presentation_model_config_invalid');
  return { visualModel, visualEffort };
}
export function presentationModelOptions(env) {
  return visualModelOptions(env.FISCH_VISUAL_MODEL, env.FISCH_VISUAL_EFFORT);
}
