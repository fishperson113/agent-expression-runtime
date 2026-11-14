import { fischCodexRuntime, fischCodexArguments, fischCodexServiceTier } from '../integrations/fisch-codex-runtime.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { codexCommand } from './start-session.mjs';

export function liveCodexArguments(_root, workspace = _root, env = process.env) {
  return ['--no-daemon', '--no-alt-screen', '-C', workspace, ...fischCodexArguments(),
    '-c', 'service_tier=' + JSON.stringify(fischCodexServiceTier(env))];
}
export async function startLiveCodex() {
  if (process.env.FISCH_LIVE !== '1') throw Error('Live environment is missing; launch with fisch live.');
  const root = fileURLToPath(new URL('../', import.meta.url)), host = await codexCommand();
  const runtime = fischCodexRuntime();
  const env = Object.fromEntries(Object.entries(runtime.env).filter(([key]) => !key.startsWith('AER_')));
  return new Promise((resolve, reject) => {
    const child = spawn(host.command, [...host.args, ...liveCodexArguments(root, runtime.cwd)], {
      cwd: runtime.cwd, env, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  startLiveCodex().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
