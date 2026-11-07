import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planSchema, plannerInstructions } from './expression-plan.mjs';

export function plannerCommand(config, schema, directory, env = process.env, platform = process.platform) {
  let command = config.command ?? config.backend, prefix = [];
  if (!config.command && platform === 'win32') {
    const paths = (env.PATH ?? env.Path ?? '').split(';');
    const executable = paths.map(path => join(path, command + '.exe')).find(existsSync);
    const cli = paths.map(path => join(path, 'node_modules/@openai/codex/bin/codex.js')).find(existsSync);
    if (executable) command = executable;
    else if (config.backend === 'codex' && cli) { command = process.execPath; prefix = [cli]; }
  }
  if (/\.(cmd|bat|ps1)$/i.test(command)) throw Error('Planner requires an executable or JavaScript CLI, not a shell shim.');
  if (/\.m?js$/i.test(command)) { prefix = [command]; command = process.execPath; }
  const args = config.backend === 'claude'
    ? ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(planSchema), '--tools', '',
      '--no-session-persistence', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', '', '--system-prompt', plannerInstructions]
    : ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only',
      '--json', '--output-schema', schema, '-C', directory,
      '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '-c', 'model_reasoning_effort="low"',
      ...['shell_tool', 'apps', 'plugins', 'hooks', 'multi_agent', 'computer_use', 'browser_use', 'image_generation', 'view_image']
        .flatMap(feature => ['--disable', feature]), '-'];
  if (config.model) args.unshift('--model', config.model);
  return { command, args: [...prefix, ...args] };
}

function terminate(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); } }
}

export function runPlannerProcess(command, args, input, signal, directory) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(Error('planner_aborted'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !key.startsWith('HERDR_') && !['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDECODE'].includes(key)));
    const child = spawn(command, args, { cwd: directory, env, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let output = '', bytes = 0, failed = false;
    const abort = () => { failed = true; terminate(child); };
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 131072) abort(); else output += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 131072) abort(); });
    child.stdin.on('error', () => {});
    child.once('error', () => { signal.removeEventListener('abort', abort); reject(Error('planner_process_unavailable')); });
    child.once('close', code => {
      signal.removeEventListener('abort', abort);
      if (failed || code !== 0) reject(Error('planner_process_failed')); else resolve(output);
    });
    child.stdin.end(input);
  });
}

export function parseProcessPlan(output, backend) {
  if (backend === 'claude') {
    const result = JSON.parse(output);
    if (result.is_error || result.subtype !== 'success') throw Error('planner_process_failed');
    return result.structured_output ?? JSON.parse(result.result);
  }
  const events = output.trim().split('\n').map(line => JSON.parse(line));
  const messages = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message');
  if (!events.some(event => event.type === 'turn.completed') || !messages.length) throw Error('incomplete_plan');
  return JSON.parse(messages.at(-1).item.text);
}

export function processPlanner(config) {
  return async (context, signal) => {
    const directory = mkdtempSync(join(tmpdir(), 'fisch-planner-')), schema = join(directory, 'schema.json');
    try {
      writeFileSync(schema, JSON.stringify(planSchema), { mode: 0o600 });
      const { command, args } = plannerCommand(config, schema, directory);
      const output = await runPlannerProcess(command, args, plannerInstructions + '\nContext data:\n' + JSON.stringify(context), signal, directory);
      return parseProcessPlan(output, config.backend);
    } finally { rmSync(schema, { force: true }); try { rmdirSync(directory); } catch {} }
  };
}
