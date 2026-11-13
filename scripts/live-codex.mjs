import { fischCodexRuntime, fischCodexArguments, fischCodexServiceTier } from '../integrations/fisch-codex-runtime.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { codexCommand } from './start-session.mjs';

export function liveCodexArguments(root, workspace = root, env = process.env) {
  return ['--no-daemon', '--no-alt-screen', '-C', workspace, ...fischCodexArguments(),
    '-c', 'service_tier=' + JSON.stringify(fischCodexServiceTier(env)),
    '-c', 'mcp_servers.fisch_live.command=' + JSON.stringify(process.execPath.replaceAll('\\', '/')),
    '-c', 'mcp_servers.fisch_live.args=' + JSON.stringify([resolve(root, 'integrations/mcp-server.mjs').replaceAll('\\', '/')]),
    '-c', 'mcp_servers.fisch_live.env_vars=["AER_BASE_URL","AER_PAIRING_TOKEN","FISCH_LIVE"]',
    '-c', 'mcp_servers.fisch_live.required=true', '-c', 'mcp_servers.fisch_live.default_tools_approval_mode="auto"'];
}
export async function startLiveCodex() {
  if (process.env.FISCH_LIVE !== '1' || !process.env.AER_BASE_URL || !process.env.AER_PAIRING_TOKEN) throw Error('Live environment is missing; launch with fisch live.');
  const root = fileURLToPath(new URL('../', import.meta.url)), host = await codexCommand();
  const runtime = fischCodexRuntime();
  return new Promise((resolve, reject) => {
    const child = spawn(host.command, [...host.args, ...liveCodexArguments(root, runtime.cwd)], {
      cwd: runtime.cwd, env: runtime.env, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  startLiveCodex().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
