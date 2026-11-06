#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const usage = `Fisch ${version} — a particle body for your agent

Usage: fisch <command>

  run        Open the body and a connected Codex session
  build      Build the frontend and native engine
  test       Build and run the automated checks
  evaluate   Run blind A/B effort comparisons, without a model
  doctor     Check local prerequisites without changing anything
  --help     Show this help
  --version  Show the installed version`;

async function run() {
  const { prepareSession, runSession } = await import('../scripts/start-session.mjs');
  await prepareSession();
  return runSession();
}
async function evaluate() {
  const { runEvaluation } = await import('../scripts/evaluate-effort.mjs');
  return runEvaluation();
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

export async function dispatch(args, handlers = { run, build, test, evaluate, doctor }) {
  if (!args.length || args.includes('--help') || args[0] === 'help') { console.log(usage); return 0; }
  if (args.length === 1 && ['--version', 'version', '-v'].includes(args[0])) {
    console.log(`Fisch ${version}`); return 0;
  }
  if (args.length !== 1 || !Object.hasOwn(handlers, args[0]))
    throw Object.assign(Error('Unknown command or option. Run fisch --help.'), { public: true });
  return await handlers[args[0]]() ?? 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  dispatch(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.public ? error.message : 'Fisch could not start. Run fisch doctor to check prerequisites.');
    process.exitCode = 1;
  });
}
