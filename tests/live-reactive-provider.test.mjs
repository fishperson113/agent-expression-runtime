import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveReactiveProvider, nativeLiveEnvironment } from '../integrations/live-reactive-provider.mjs';
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal(); return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
const directories = [], now = () => 100;
const config = { FISCH_REACTIVE_BACKEND: 'responses', FISCH_REACTIVE_MODEL: 'fake-model',
  FISCH_REACTIVE_URL: 'https://provider.invalid/responses', FISCH_REACTIVE_API_KEY: 'test-only-key' };
function ledger(values = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fisch-provider-factory-')); directories.push(directory);
  const path = join(directory, 'approved-budget.json');
  writeFileSync(path, JSON.stringify({ deadline: new Date(10000).toISOString(), limit: 120, used: 119, turns: [], ...values }));
  return path;
}
const window = (requestId = 'r') => ({ schemaVersion: 1, request: { schemaVersion: 1, sessionId: 's', epoch: 'e',
  requestId, intentRevision: 0, presenceRevision: 0, deadline: 1000, requiredTrackIds: [] },
  events: [{ id: 1, type: 'user_left', at: 100 }], observations: [{ v: 1, sessionId: 's', seq: 1, capturedAt: 100,
    camera: 'absent', turn: 'idle', summary: '', user: { present: false, quality: { score: 0, basis: 'unavailable' },
      position: null, head: null, facingScreen: null, expression: null, mouthMoving: null } }] });
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); vi.clearAllMocks(); });
it('defaults off without reading files, clock or network despite unrelated credentials', () => {
  const fetch = vi.fn(), clock = vi.fn(); readFileSync.mockClear();
  expect(createLiveReactiveProvider({ OPENAI_API_KEY: 'native-private', FISCH_REACTIVE_BUDGET: '/not-read' }, { fetch, now: clock }))
    .toEqual({ provider: null, reason: 'disabled_by_config' });
  expect(readFileSync).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(clock).not.toHaveBeenCalled();
});
it('requires an explicit existing absolute ledger and returns only fixed failure metadata', () => {
  expect(createLiveReactiveProvider(config, { now })).toEqual({ provider: null, reason: 'missing_budget' });
  expect(createLiveReactiveProvider({ ...config, FISCH_REACTIVE_BUDGET: 'budget.json' }, { now }))
    .toEqual({ provider: null, reason: 'invalid_budget_path' });
  const path = ledger(); rmSync(path);
  expect(createLiveReactiveProvider({ ...config, FISCH_REACTIVE_BUDGET: path }, { now }))
    .toEqual({ provider: null, reason: 'budget_unavailable' });
  writeFileSync(path, 'malformed');
  expect(createLiveReactiveProvider({ ...config, FISCH_REACTIVE_BUDGET: path }, { now }).reason).toBe('budget_unavailable');
  expect(readFileSync(path, 'utf8')).toBe('malformed');
});
it('refuses exhausted and expired approved ledgers without altering them or dispatching', () => {
  const fetch = vi.fn();
  for (const [values, reason] of [[{ used: 120 }, 'budget_exhausted'], [{ deadline: new Date(100).toISOString() }, 'budget_expired']]) {
    const path = ledger(values), before = readFileSync(path, 'utf8');
    expect(createLiveReactiveProvider({ ...config, FISCH_REACTIVE_BUDGET: path }, { now, fetch })).toEqual({ provider: null, reason });
    expect(readFileSync(path, 'utf8')).toBe(before);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('atomically reserves the cumulative final turn before HTTP and blocks the next dispatch', async () => {
  const path = ledger(), fetch = vi.fn(async (_url, options) => {
    const budget = JSON.parse(readFileSync(path, 'utf8'));
    expect(budget.used).toBe(120); expect(budget.turns).toHaveLength(1); expect(budget.turns[0].purpose).toBe('reactive:r');
    const request = JSON.parse(JSON.parse(options.body).input).request;
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify({ schemaVersion: 1, requestId: request.requestId,
        decisionId: 'd', mode: 'observe', validUntil: 900, action: null }) }] }] }));
  });
  const result = createLiveReactiveProvider({ ...config, FISCH_REACTIVE_BUDGET: path }, { now, fetch });
  expect(result.reason).toBe('ready'); expect(JSON.stringify(result)).toBe('{"provider":{},"reason":"ready"}');
  await expect(result.provider.decide(window())).resolves.toMatchObject({ mode: 'observe' });
  await expect(result.provider.decide(window('r2'))).rejects.toThrow('reactive_budget_denied');
  expect(fetch).toHaveBeenCalledTimes(1); expect(JSON.parse(readFileSync(path)).used).toBe(120);
});
it('rechecks expiry at reservation and never resets the ledger', async () => {
  const path = ledger(), fetch = vi.fn(); let at = 100;
  const result = createLiveReactiveProvider({ ...config, FISCH_REACTIVE_BUDGET: path }, { now: () => at, fetch });
  at = 10000; await expect(result.provider.decide(window())).rejects.toThrow('reactive_budget_denied');
  expect(fetch).not.toHaveBeenCalled(); expect(JSON.parse(readFileSync(path)).used).toBe(119);
});
it('filters every dedicated reactive variable without mutating the native environment', () => {
  const original = { ...config, FISCH_REACTIVE_BUDGET: '/private/approved.json', FISCH_REACTIVE_FUTURE_SECRET: 'private',
    OPENAI_API_KEY: 'native-key', AER_PAIRING_TOKEN: 'pairing', PATH: '/bin', FISCH_LIVE: '1' };
  const copy = { ...original }, filtered = nativeLiveEnvironment(original);
  expect(filtered).toEqual({ OPENAI_API_KEY: 'native-key', AER_PAIRING_TOKEN: 'pairing', PATH: '/bin', FISCH_LIVE: '1' });
  expect(original).toEqual(copy); expect(filtered).not.toBe(original);
});
it('contains invalid configuration errors without returning credentials or reading a ledger', () => {
  readFileSync.mockClear(); const fetch = vi.fn();
  for (const patch of [{ FISCH_REACTIVE_URL: 'https://secret:private@provider.invalid' },
    { FISCH_REACTIVE_API_KEY: 'private\nheader' }, { FISCH_REACTIVE_BACKEND: 'unknown-private' }]) {
    expect(createLiveReactiveProvider({ ...config, ...patch, FISCH_REACTIVE_BUDGET: '/private/not-read' }, { fetch, now }))
      .toEqual({ provider: null, reason: 'invalid_provider_config' });
  }
  expect(readFileSync).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
