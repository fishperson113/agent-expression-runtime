const reasons = ['disabled_by_config', 'missing_model_or_endpoint', 'missing_api_key', 'invalid_provider_config',
  'missing_budget', 'invalid_budget_path', 'budget_unavailable', 'budget_expired', 'budget_exhausted'];

export function liveSetupStatus(native, configured) {
  const observer = configured?.provider ? 'ready' : reasons.includes(configured?.reason) ? configured.reason : 'unavailable';
  return Object.freeze({ native: native === 'connected' ? 'connected' : 'waiting', observer });
}
