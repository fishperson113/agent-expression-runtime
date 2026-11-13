import { createLiveReactiveProvider } from '../integrations/live-reactive-provider.mjs';
import { createLivePane } from '../integrations/live-launch.mjs';
import { it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fischCodexRuntime, fischCodexArguments, ensureFischCodexLogin, prepareFischCodexRuntime } from '../integrations/fisch-codex-runtime.mjs';
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
  for (const value of ['mcp_servers={}', 'project_doc_max_bytes=0', 'features.skip_host_skill_discovery=true', 'hooks', 'plugins', 'apps']) expect(args).toContain(value);
});
it.each(['thread/start', 'thread/resume', 'thread/fork'])('pins %s to the scoped workspace and Fisch instructions', method => {
  const input = { method, params: { cwd: '/external', config: { mcp_servers: {} }, path: '/global/session', developerInstructions: 'external', skillRoots: ['external'], threadId: 'keep' } };
  const result = scopedLiveRequest(input, '/fisch/workspace', 'Body instructions');
  expect(result.params.cwd).toBe('/fisch/workspace');
  expect(result.params.config).toBeUndefined(); expect(result.params.path).toBeUndefined();
  expect(result.params.skillRoots).toBeUndefined(); expect(result.params.threadId).toBe('keep');
  expect(result.params.developerInstructions).toContain('Body instructions');
  expect(result.params.developerInstructions).not.toContain('external');
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
      if (method === 'mcpServerStatus/list') return { data: [], nextCursor: null };
      return {};
    }
  }
  const runtime = { cwd: '/fisch', env: { CODEX_HOME: '/fisch' } };
  expect(await prepareFischCodexRuntime({ command: 'codex', args: [] }, runtime, { Rpc })).toBe(runtime);
  expect(calls).toContainEqual({ method: 'skills/config/write', params: { path: '/external/SKILL.md', enabled: false } });
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
