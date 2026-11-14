import { liveCodexArguments } from '../scripts/live-codex.mjs';
import { createLiveReactiveProvider } from '../integrations/live-reactive-provider.mjs';
import { createLivePane } from '../integrations/live-launch.mjs';
import { it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fischCodexRuntime, fischCodexArguments, fischCodexServiceTier, ensureFischCodexLogin, prepareFischCodexRuntime } from '../integrations/fisch-codex-runtime.mjs';
import { scopedLiveRequest } from '../integrations/live-codex-transport.mjs';

it('uses a dedicated workspace without inheriting global credentials or Codex overrides', () => {
  const home = mkdtempSync(join(tmpdir(), 'fisch-scope-'));
  try {
    const runtime = fischCodexRuntime({ FISCH_CODEX_HOME: join(home, 'private'), CODEX_HOME: join(home, 'global'), OPENAI_API_KEY: 'sentinel', PATH: 'keep' }, home);
    expect(runtime.cwd).toBe(join(home, 'private', 'workspace'));
    expect(runtime.env.OPENAI_API_KEY).toBeUndefined();
    expect(runtime.env.CODEX_HOME).toBe(join(home, 'private'));
    expect(runtime.env.PATH).toBe('keep');
    writeFileSync(join(runtime.home, 'AGENTS.md'), 'sentinel');
    expect(() => fischCodexRuntime({ FISCH_CODEX_HOME: runtime.home }, home)).toThrow('custom instructions');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it('rejects the global default and custom home', () => {
  expect(() => fischCodexRuntime({ FISCH_CODEX_HOME: join(tmpdir(), '.codex') }, tmpdir())).toThrow('own CODEX_HOME');
  expect(() => fischCodexRuntime({ FISCH_CODEX_HOME: tmpdir(), CODEX_HOME: tmpdir() })).toThrow('own CODEX_HOME');
});
it('disables inherited hooks, host skills and unrelated MCP configuration', () => {
  const args = fischCodexArguments();
  for (const value of ['mcp_servers={}', 'project_doc_max_bytes=0', 'features.skip_host_skill_discovery=true', 'hooks', 'plugins={}', 'marketplaces={}']) expect(args).toContain(value);
});
it.each(['thread/start', 'thread/resume', 'thread/fork'])('isolates %s while appending expression instructions to native instructions', method => {
  const input = { method, params: { cwd: '/external', config: { mcp_servers: {} }, path: '/global/session', developerInstructions: 'external', skillRoots: ['external'], threadId: 'keep' } };
  const result = scopedLiveRequest(input, '/fisch/workspace', 'Body instructions');
  expect(result.params.cwd).toBe('/fisch/workspace');
  expect(result.params.config).toBeUndefined(); expect(result.params.path).toBeUndefined();
  expect(result.params.skillRoots).toBeUndefined(); expect(result.params.threadId).toBe('keep');
  expect(result.params.developerInstructions).toContain('Body instructions');
  expect(result.params.developerInstructions).toContain('external');
  expect(input.params.cwd).toBe('/external');
});
it('keeps turn input but not request-level config or cwd overrides', () => {
  const input = [{ type: 'text', text: 'alo' }];
  expect(scopedLiveRequest({ method: 'turn/start', params: { input, cwd: '/external', config: {} } }, '/fisch', '').params).toEqual({ input, cwd: '/fisch' });
});
it('checks existing scoped auth without launching another login', async () => {
  const runtime = { cwd: '/fisch', env: { CODEX_HOME: '/fisch' } };
  const result = await ensureFischCodexLogin({ command: 'codex', args: [] }, { runtime, run: async (_cmd, args, options) => {
    expect(args).toEqual(['login', 'status']); expect(options.env).toBe(runtime.env);
  }, launch: () => { throw Error('unexpected login'); } });
  expect(result).toBe(runtime);
});

it('disables all discovered skills through scoped Codex API before use', async () => {
  const calls = []; let enabled = true;
  class Rpc {
    settled = Promise.resolve(); send() {} close() {}
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'skills/config/write') enabled = false;
      if (method === 'skills/list') return { data: [{ errors: [], skills: [{ path: '/external/SKILL.md', enabled }] }] };
      if (method === 'config/read') return { config: { mcp_servers: {}, plugins: {}, marketplaces: {} } };
      return {};
    }
  }
  const runtime = { cwd: '/fisch', env: { CODEX_HOME: '/fisch' } };
  expect(await prepareFischCodexRuntime({ command: 'codex', args: [] }, runtime, { Rpc })).toBe(runtime);
  expect(calls).toContainEqual({ method: 'skills/config/write', params: { path: '/external/SKILL.md', enabled: false } });
  expect(calls.some(call => call.method === 'mcpServerStatus/list')).toBe(false);
  expect(calls).toContainEqual({ method: 'config/read', params: { cwd: '/fisch', includeLayers: false } });
});

it('forwards a custom dedicated Codex home to the Herdr child', async () => {
  const previous = process.env.FISCH_CODEX_HOME; process.env.FISCH_CODEX_HOME = '/custom/fisch';
  const calls = [];
  try {
    await createLivePane(async (method, params) => {
      calls.push({ method, params });
      if (method === 'tab.create') return { tab: { tab_id: 'tab' } };
      return { snapshot: { panes: [{ tab_id: 'tab', pane_id: 'pane' }] } };
    }, { cwd: '/project', workspace_id: 'work' }, 'http://127.0.0.1', 'test');
    expect(calls[0].params.env.FISCH_CODEX_HOME).toBe('/custom/fisch');
  } finally { if (previous === undefined) delete process.env.FISCH_CODEX_HOME; else process.env.FISCH_CODEX_HOME = previous; }
});

it('does not serialize the observation worker environment into provider status', () => {
  const home = mkdtempSync(join(tmpdir(), 'fisch-provider-'));
  try {
    const value = createLiveReactiveProvider({ XDG_DATA_HOME: home, LOCALAPPDATA: home }, { defaultNative: true });
    expect(value.provider).toBeTruthy();
    expect(Object.keys(value.provider)).not.toContain('environment');
    expect(JSON.parse(JSON.stringify(value)).provider.environment).toBeUndefined();
    value.provider.close();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it('uses priority only in Live configuration, with an explicit standard-speed opt-out', () => {
  expect(fischCodexServiceTier({})).toBe('priority');
  expect(fischCodexServiceTier({ FISCH_CODEX_SERVICE_TIER: 'default' })).toBe('default');
  expect(() => fischCodexServiceTier({ FISCH_CODEX_SERVICE_TIER: 'invalid' })).toThrow('must be');
  expect(liveCodexArguments('/root', '/work', {})).toContain('service_tier="priority"');
  expect(liveCodexArguments('/root', '/work', { FISCH_CODEX_SERVICE_TIER: 'default' })).toContain('service_tier="default"');
  expect(fischCodexArguments().some(value => value.includes('service_tier'))).toBe(false);
});
it.each(['thread/start', 'thread/resume', 'thread/fork'])('defaults %s tier but preserves an explicit provider choice', method => {
  expect(scopedLiveRequest({ method, params: {} }, '/fisch', '', 'priority').params.serviceTier).toBe('priority');
  expect(scopedLiveRequest({ method, params: {} }, '/fisch', '', 'default').params.serviceTier).toBe('default');
  const input = { method, params: { serviceTier: 'default' } };
  expect(scopedLiveRequest(input, '/fisch', '', 'priority').params.serviceTier).toBe('default');
  expect(input.params).toEqual({ serviceTier: 'default' });
});
it('lets turns inherit the thread or explicitly override tier without automatic replay', () => {
  const input = { method: 'turn/start', params: { threadId: 'same', serviceTier: 'default', serviceTierForTurn: 'priority' } };
  expect(scopedLiveRequest(input, '/fisch', '', 'default').params).toEqual({ ...input.params, cwd: '/fisch' });
  expect(scopedLiveRequest({ method: 'turn/start', params: {} }, '/fisch', '', 'priority').params).toEqual({ cwd: '/fisch' });
});

it('isolates extensions without disabling native tools or changing model effort', () => {
  const args = fischCodexArguments();
  for (const feature of ['shell_tool', 'multi_agent', 'computer_use', 'browser_use', 'image_generation', 'apps', 'plugins']) expect(args).not.toContain(feature);
  expect(args.some(value => /web_search|model_reasoning_effort|model=/.test(value))).toBe(false);
});
it.each(['thread/start', 'thread/resume', 'thread/fork', 'turn/start'])('preserves native choices and approval boundaries for %s', method => {
  const input = { method, params: { model: 'native-choice', effort: 'high', approvalPolicy: 'on-request', sandbox: 'read-only',
    baseInstructions: 'Native baseline', developerInstructions: 'User selected style',
    config: { model: 'native-choice', model_reasoning_effort: 'high', model_verbosity: 'high', service_tier: 'default',
      hooks: {}, 'features.hooks': true, mcp_servers: { extra: {} }, developer_instructions: 'global leak', project_doc_max_bytes: 999 },
    dynamicTools: [{ name: 'external' }], skillRoots: ['/global'] } };
  const result = scopedLiveRequest(input, '/fisch', 'Expression API');
  expect(result.params.config).toEqual({ model: 'native-choice', model_reasoning_effort: 'high', model_verbosity: 'high', service_tier: 'default' });
  expect(result.params.model).toBe('native-choice'); expect(result.params.effort).toBe('high');
  expect(result.params.approvalPolicy).toBe('on-request'); expect(result.params.sandbox).toBe('read-only');
  expect(result.params.baseInstructions).toBe('Native baseline');
  expect(result.params.developerInstructions).toContain('User selected style');
  if (method !== 'turn/start') {
    expect(result.params.developerInstructions).toContain('Expression API');
    expect(result.params.dynamicTools).toBeUndefined(); expect(result.params.skillRoots).toBeUndefined();
  }
  expect(input.params.config.hooks).toEqual({});
});

it.each(['mcp_servers', 'plugins', 'marketplaces'])('fails closed on unexpected scoped %s configuration', async key => {
  class Rpc {
    settled = Promise.resolve(); send() {} close() {}
    async request(method) {
      if (method === 'skills/list') return { data: [{ errors: [], skills: [] }] };
      if (method === 'config/read') return { config: { mcp_servers: {}, plugins: {}, marketplaces: {}, [key]: { external: {} } } };
      return {};
    }
  }
  await expect(prepareFischCodexRuntime({ command: 'codex', args: [] }, { cwd: '/fisch', env: {} }, { Rpc })).rejects.toThrow('isolated integration configuration');
});
