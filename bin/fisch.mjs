#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const usage = `Fisch ${version} — a particle body for your agent

Usage: fisch <command>

  run        Show the body; automatically react through Codex/Claude prompt hooks
  live       Open local camera/WebGL workspace and a dedicated Codex pane
  status     Inspect the body attached to this agent pane
  express    Debug: send a JSON AST to the attached body
  cancel     Cancel expressions and reset posture
  stop       Stop the attached body, keeping the agent running
  capabilities  Debug: print the expression contract
  build      Build the frontend and native engine
  test       Build and run the automated checks
  evaluate   Run browser reference A/B comparisons, without a model
  doctor     Check local prerequisites without changing anything
  hooks      Explicitly install, uninstall or inspect Codex/Claude hooks
  --help     Show this help
  --version  Show the installed version`;

async function run(options) {
  const { runPaneSession } = await import('../scripts/pane-session.mjs');
  return runPaneSession(options);
}
async function evaluate() {
  const { runEvaluation } = await import('../scripts/evaluate-effort.mjs');
  return runEvaluation();
}
async function live(options) {
  const { runLiveSession } = await import('../scripts/live-session.mjs');
  return runLiveSession(options);
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
  const { paneDoctor } = await import('../integrations/herdr.mjs');
  const checks = await paneDoctor();
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

export async function dispatch(args, handlers = { run, live, build, test, evaluate, doctor }) {
  if (!args.length || args.includes('--help') || args[0] === 'help') { console.log(usage); return 0; }
  if (args.length === 1 && ['--version', 'version', '-v'].includes(args[0])) {
    console.log(`Fisch ${version}`); return 0;
  }
  if (args.length === 1 && args[0] === 'capabilities') {
    const { capabilities } = await import('../scripts/pane-session.mjs');
    console.log(JSON.stringify(capabilities())); return 0;
  }
  if (['express', 'status', 'cancel', 'stop'].includes(args[0])) return control(args);
  if (args[0] === 'hooks') return (handlers.hooks ?? hooks)(args.slice(1));
  if (args.length === 3 && args[0] === 'run' && args[1] === '--agent') return handlers.run({ agentPane: args[2] });
  if (args.length === 3 && args[0] === 'live' && args[1] === '--agent') return handlers.live({ agentPane: args[2] });
  if (args.length !== 1 || !Object.hasOwn(handlers, args[0]))
    throw Object.assign(Error('Unknown command or option. Run fisch --help.'), { public: true });
  return await handlers[args[0]]() ?? 0;
}

async function control(args) {
  let value;
  if (args[0] === 'express') {
    try {
      if (args.length !== 2) throw Error();
      value = JSON.parse(args[1]);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
      if (value.type) value = { body: value };
    } catch { throw Object.assign(Error('Pass one JSON AST argument: fisch express \'{"type":"morph","target":"sphere","durationMs":900}\''), { public: true }); }
  } else if (args.length !== 1) throw Object.assign(Error('Unexpected option. Run fisch --help.'), { public: true });
  const { sendControl } = await import('../integrations/terminal-ipc.mjs');
  const receipt = await sendControl(args[0], value);
  console.log(JSON.stringify(receipt));
  return receipt.status === 'rejected' ? 1 : 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  dispatch(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.public ? error.message : 'Fisch could not start. Run fisch doctor to check prerequisites.');
    process.exitCode = 1;
  });
}
