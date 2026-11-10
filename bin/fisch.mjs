#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const usage = `Fisch ${version} — a particle body for your agent

Usage: fisch <command>

  live [--hands] [--no-assets]  Prepare and open the local body and Codex in this terminal (Herdr optional)
  status     Inspect Live from its dedicated --agent Herdr pane
  stop       Stop Live from its dedicated --agent Herdr pane
  capabilities  Debug: print the expression contract
  build      Build the frontend and native engine
  test       Build and run the automated checks
  evaluate   Run browser reference A/B comparisons, without a model
  doctor     Check local prerequisites without changing anything
  hooks      Manage optional native hooks (not needed for normal-terminal Live)
  --help     Show this help
  --version  Show the installed version`;

async function evaluate() {
  const { runEvaluation } = await import('../scripts/evaluate-effort.mjs');
  return runEvaluation();
}
async function live(options) {
  const abort = new AbortController(), stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const { ensureLiveDependencies } = await import('../scripts/prepare-live.mjs');
    await ensureLiveDependencies({ signal: abort.signal });
    const { runLiveSession } = await import('../scripts/live-session.mjs');
    return await runLiveSession({ ...options, signal: abort.signal });
  } catch (error) {
    if (abort.signal.aborted) return 130;
    error.public = true; throw error;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
async function build() {
  const { prepareSession } = await import('../scripts/start-session.mjs');
  await prepareSession({ withCodex: false });
}
async function test() {
  const { testSession } = await import('../scripts/start-session.mjs');
  await testSession();
}
async function doctor() {
  const { inspectEnvironment } = await import('../scripts/start-session.mjs');
  const checks = await inspectEnvironment();
  for (const check of checks) console.log(`${check.ok ? 'OK' : 'MISSING'} ${check.name}: ${check.detail}`);
  return checks.every(check => check.ok || check.optional) ? 0 : 1;
}
async function hooks(args) {
  const [action, provider] = args;
  if (args.length > 2 || !['install', 'uninstall', 'status'].includes(action) ||
      (provider && !['codex', 'claude'].includes(provider)) || (action === 'install' && !provider))
    throw Object.assign(Error('Use fisch hooks install codex|claude, fisch hooks uninstall [codex|claude], or fisch hooks status.'), { public: true });
  const { installInteractionHooks, uninstallInteractionHooks, inspectInteractionHooks } = await import('../integrations/interaction-hooks.mjs');
  const results = [];
  for (const agent of provider ? [provider] : ['codex', 'claude']) {
    results.push(action === 'install' ? await installInteractionHooks({ agent }) :
      action === 'uninstall' ? uninstallInteractionHooks(agent) : inspectInteractionHooks({ agent }));
  }
  console.log(JSON.stringify(results));
  return results.some(result => result.error) ? 1 : 0;
}

export async function dispatch(args, handlers = { live, build, test, evaluate, doctor }) {
  if (['run', 'express', 'cancel'].includes(args[0]))
    throw Object.assign(Error(`fisch ${args[0]} has been removed. Use fisch live; express/cancel_expression are Live MCP tools, not CLI commands.`), { public: true });
  if (!args.length || args.includes('--help') || args[0] === 'help') { console.log(usage); return 0; }
  if (args.length === 1 && ['--version', 'version', '-v'].includes(args[0])) {
    console.log(`Fisch ${version}`); return 0;
  }
  if (args.length === 1 && args[0] === 'capabilities') {
    console.log(JSON.stringify({
      capabilities: JSON.parse(readFileSync(new URL('../src/contracts/capabilities.json', import.meta.url), 'utf8')),
      schema: JSON.parse(readFileSync(new URL('../src/contracts/protocol.schema.json', import.meta.url), 'utf8')),
      instructions: readFileSync(new URL('../integrations/instructions-v1.md', import.meta.url), 'utf8'),
    })); return 0;
  }
  if (['status', 'stop'].includes(args[0])) return control(args);
  if (args[0] === 'hooks') return (handlers.hooks ?? hooks)(args.slice(1));
  if (args[0] === 'live') return handlers.live(parseLiveOptions(args.slice(1)));
  if (args.length !== 1 || !['build', 'test', 'evaluate', 'doctor'].includes(args[0]) || !Object.hasOwn(handlers, args[0]))
    throw Object.assign(Error('Unknown command or option. Run fisch --help.'), { public: true });
  return await handlers[args[0]]() ?? 0;
}

export function parseLiveOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hands' && options.hands === undefined) options.hands = true;
    else if (args[i] === '--no-assets' && options.assets === undefined) options.assets = false;
    else if (args[i] === '--agent' && !options.agentPane && args[i + 1] && !args[i + 1].startsWith('--')) options.agentPane = args[++i];
    else throw Object.assign(Error('Use fisch live [--hands] [--no-assets] [--agent pane].'), { public: true });
  }
  if (options.hands && options.assets === false) throw Object.assign(Error('--hands needs assets; remove --no-assets.'), { public: true });
  return options;
}

async function control(args) {
  if (args.length !== 1) throw Object.assign(Error('Unexpected option. Run fisch --help.'), { public: true });
  const { sendControl } = await import('../integrations/terminal-ipc.mjs');
  const receipt = await sendControl(args[0]);
  console.log(JSON.stringify(receipt));
  return receipt.status === 'rejected' ? 1 : 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  dispatch(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.public ? error.message : 'Fisch could not start. Run fisch doctor to check prerequisites.');
    process.exitCode = 1;
  });
}
