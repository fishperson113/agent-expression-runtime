import { expect, it } from 'vitest';
import { liveSetupStatus } from '../integrations/live-setup-status.mjs';

it('separates selected Native ownership from observer preflight without exposing configuration', () => {
  const config = { provider: null, reason: 'missing_budget', endpoint: 'https://private.example', key: 'PRIVATE_KEY', path: '/private/ledger' };
  expect(liveSetupStatus('waiting', config)).toEqual({ native: 'waiting', observer: 'missing_budget' });
  expect(liveSetupStatus('connected', config)).toEqual({ native: 'connected', observer: 'missing_budget' });
  const serialized = JSON.stringify(liveSetupStatus('connected', config));
  expect(serialized).not.toMatch(/PRIVATE|private|endpoint|path|key/);
  expect(Object.isFrozen(liveSetupStatus('waiting', config))).toBe(true);
});

it.each(['disabled_by_config', 'missing_model_or_endpoint', 'missing_api_key', 'invalid_provider_config', 'missing_budget',
  'invalid_budget_path', 'budget_unavailable', 'budget_expired', 'budget_exhausted'])('retains only fixed preflight reason %s', reason => {
  expect(liveSetupStatus('waiting', { provider: null, reason })).toEqual({ native: 'waiting', observer: reason });
});

it('requires an actual provider for configured status and fails closed on unknown labels', () => {
  expect(liveSetupStatus('connected', { provider: {}, reason: '/private/secret' })).toEqual({ native: 'connected', observer: 'ready' });
  for (const reason of ['ready', '<img src=x>', '/private/key=SECRET', null, {}])
    expect(liveSetupStatus('connected', { provider: null, reason })).toEqual({ native: 'connected', observer: 'unavailable' });
  expect(liveSetupStatus('untrusted', null)).toEqual({ native: 'waiting', observer: 'unavailable' });
});
