import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PlannerRpc } from './planner-rpc.mjs';
import { stopChild } from '../scripts/start-session.mjs';

export function fischCodexRuntime(env = process.env, home = homedir()) {
  const data = process.platform === 'win32' ? env.LOCALAPPDATA ?? join(home, 'AppData', 'Local') : env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  const codexHome = resolve(env.FISCH_CODEX_HOME ?? join(data, 'fisch', 'codex'));
  const normalized = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  const globalHomes = [join(home, '.codex'), env.CODEX_HOME].filter(Boolean);
  if (globalHomes.some(value => normalized(value) === normalized(codexHome))) throw Error('Fisch needs its own CODEX_HOME, not the global Codex directory.');
  for (const name of ['AGENTS.md', 'AGENTS.override.md', 'hooks.json']) {
    if (existsSync(join(codexHome, name))) throw Error('Remove custom instructions, skills or hooks from the dedicated Fisch runtime before starting.');
  }
  const skills = join(codexHome, 'skills');
  if (existsSync(skills) && readdirSync(skills).some(name => name !== '.system')) throw Error('The dedicated Fisch runtime cannot contain custom skills.');
  const cwd = join(codexHome, 'workspace');
  mkdirSync(cwd, { recursive: true });
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !/^(CODEX_|OPENAI_|HERDR_|CLAUDECODE$)/i.test(key)));
  return { home: codexHome, cwd, env: { ...clean, CODEX_HOME: codexHome } };
}

export function fischCodexArguments() {
  return ['-c', 'mcp_servers={}', '-c', 'project_doc_max_bytes=0', '-c', 'developer_instructions=""', '-c', 'web_search="disabled"',
    '-c', 'features.skip_host_skill_discovery=true', '-c', 'features.omit_skill_descriptions=true',
    ...['hooks', 'plugins', 'apps', 'skill_search', 'shell_tool', 'multi_agent', 'computer_use', 'browser_use', 'image_generation']
      .flatMap(name => ['--disable', name])];
}

export async function ensureFischCodexLogin(host, { signal, runtime = fischCodexRuntime(), run = promisify(execFile), launch = spawn } = {}) {
  if (signal?.aborted) throw Error('live_start_cancelled');
  try {
    await run(host.command, [...host.args, 'login', 'status'], { cwd: runtime.cwd, env: runtime.env, windowsHide: true, timeout: 15000, signal });
    return runtime;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.code !== 1) throw Error('Could not check Fisch Codex login; check the Codex installation and retry.');
  }
  console.log('Fisch uses a separate Codex login and workspace. Complete the one-time login below; global Codex stays unchanged.');
  await new Promise((accept, reject) => {
    const child = launch(host.command, [...host.args, 'login', '--device-auth'], { cwd: runtime.cwd, env: runtime.env, windowsHide: true, stdio: 'inherit' });
    const abort = () => { void stopChild(child).catch(reject); };
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', reject);
    child.once('exit', code => { signal?.removeEventListener('abort', abort); code === 0 ? accept() : reject(Error('Fisch Codex login was not completed. Run fisch live to retry.')); });
    if (signal?.aborted) abort();
  });
  if (signal?.aborted) throw Error('live_start_cancelled');
  return runtime;
}
export async function prepareFischCodexRuntime(host, runtime = fischCodexRuntime(), { signal, Rpc = PlannerRpc } = {}) {
  if (signal?.aborted) throw Error('live_start_cancelled');
  const rpc = new Rpc(host.command, [...host.args, 'app-server', '--stdio', ...fischCodexArguments()], runtime.cwd, () => {}, () => {}, runtime.env);
  const abort = () => rpc.close(); signal?.addEventListener('abort', abort, { once: true });
  try {
    await rpc.request('initialize', { clientInfo: { name: 'fisch_runtime_setup', version: '1' }, capabilities: { experimentalApi: true } });
    rpc.send({ method: 'initialized', params: {} });
    const listed = await rpc.request('skills/list', { cwds: [runtime.cwd], forceReload: true });
    for (const row of listed.data ?? []) {
      if (row.errors?.length) throw Error('Fisch could not verify discovered skills.');
      for (const skill of row.skills ?? []) if (skill.enabled) await rpc.request('skills/config/write', { path: skill.path, enabled: false });
    }
    const checked = await rpc.request('skills/list', { cwds: [runtime.cwd], forceReload: true });
    if (!checked.data?.length || checked.data.some(row => row.errors?.length || row.skills?.some(skill => skill.enabled))) throw Error('Fisch could not disable external skills.');
    const catalog = await rpc.request('mcpServerStatus/list', {});
    if (catalog.nextCursor != null || catalog.data?.some(server => Object.keys(server.tools ?? {}).length)) throw Error('Fisch found an unexpected MCP integration.');
    return runtime;
  } finally { signal?.removeEventListener('abort', abort); rpc.close(); await rpc.settled; }
}
