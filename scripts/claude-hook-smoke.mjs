import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plannerCommand } from '../integrations/planner-process.mjs';

function fixtures(directory) {
  const capture = join(directory, 'capture.cjs'), report = join(directory, 'events.jsonl');
  writeFileSync(capture, `const fs=require('node:fs');let text='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{try{const v=JSON.parse(text),r=v.tool_response;
fs.appendFileSync(${JSON.stringify(report)},JSON.stringify({event:v.hook_event_name,tool:v.tool_name,hasPromptId:!!v.prompt_id,
command:v.tool_input?.command,responseFields:r?Object.keys(r):[],exitCode:r?.exit_code??r?.exitCode,
interrupted:r?.interrupted,errorExitCode:/^Exit code (\\d+)/.exec(v.error??'')?.[1]})+'\\n');}catch{}});`);
  writeFileSync(join(directory, 'pass.test.mjs'), "import {test} from 'node:test';test('pass',()=>{});\n");
  writeFileSync(join(directory, 'fail.test.mjs'), "import {test} from 'node:test';test('fail',()=>{throw Error('synthetic failure')});\n");
  const handler = { type: 'command', command: `node "${capture.replaceAll('\\', '/')}"`, timeout: 2 };
  const settings = join(directory, 'settings.json');
  writeFileSync(settings, JSON.stringify({ hooks: Object.fromEntries(['UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure'].map(event => [event, [{ hooks: [handler] }]])) }));
  return { report, settings };
}
async function probe(directory, settings) {
  const resolved = plannerCommand({ backend: 'claude' }, '', directory);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HERDR_') && key !== 'CLAUDECODE'));
  const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--setting-sources', '', '--settings', settings,
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', 'Bash',
    '--allowedTools', 'Bash(node --test pass.test.mjs)', 'Bash(node --test fail.test.mjs)',
    '--max-turns', '4', '--system-prompt', 'Run only the two explicitly requested fixture test commands. Do not write files or run other commands.'];
  return new Promise((resolve, reject) => {
    const child = spawn(resolved.command, args, { cwd: directory, env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); reject(Error('claude_probe_timeout')); }, 90000);
    child.once('error', () => { clearTimeout(timer); reject(Error('claude_unavailable')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('claude_probe_failed')); });
    child.stdin.end('Use Bash to execute exactly node --test pass.test.mjs and node --test fail.test.mjs, once each. The failure is intentional. Then reply done.');
  });
}
const directory = mkdtempSync(join(tmpdir(), 'fisch-claude-probe-'));
const files = ['capture.cjs', 'events.jsonl', 'pass.test.mjs', 'fail.test.mjs', 'settings.json'];
try {
  const { report, settings } = fixtures(directory); await probe(directory, settings);
  const events = readFileSync(report, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const success = events.find(event => event.event === 'PostToolUse' && event.command === 'node --test pass.test.mjs');
  const failure = events.find(event => event.event === 'PostToolUseFailure' && event.command === 'node --test fail.test.mjs');
  if (!success || !failure) throw Error('claude_hook_events_missing');
  const evidence = { synthetic: true, events, successObserved: true, failureObserved: true };
  writeFileSync('docs/evidence/claude-hook-smoke.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally {
  for (const file of files) rmSync(join(directory, file), { force: true });
  try { rmdirSync(directory); } catch {}
}
