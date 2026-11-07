import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, rmdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeHook, validEvent } from '../integrations/interaction-events.mjs';
import { hookConfiguration, installInteractionHooks, inspectInteractionHooks, uninstallInteractionHooks } from '../integrations/interaction-hooks.mjs';
import { hookPaths } from '../integrations/hook-storage.mjs';
import { forwardHook, readHook } from '../scripts/fisch-hook.mjs';
import { openControl } from '../integrations/terminal-ipc.mjs';

const prompt = { session_id: 'session', turn_id: 'turn', hook_event_name: 'UserPromptSubmit', prompt: 'Cảm ơn bạn!' };
it('extracts actual Codex and Claude prompts with turn identity and redaction', () => {
  const event = normalizeHook(prompt);
  expect(event).toMatchObject({ type: 'user_message', turnId: 'turn', text: 'Cảm ơn bạn!' });
  expect(validEvent(event)).toBe(true);
  expect(normalizeHook({ ...prompt, turn_id: undefined, prompt_id: 'claude-turn' }).turnId).toBe('claude-turn');
  expect(normalizeHook({ ...prompt, prompt: 'token=private sk-abcdefghijklmnopqrstuvwxyz' }).text).not.toContain('private');
  expect(normalizeHook({ ...prompt, agent_id: 'subagent' })).toBeNull();
  expect(validEvent({ ...event, at: event.at - 31000 })).toBe(false);
});
it('only forwards explicit lifecycle events and structured task outcomes, never arbitrary tool text', () => {
  expect(normalizeHook({ ...prompt, hook_event_name: 'Stop' }).type).toBe('work_finished');
  expect(normalizeHook({ ...prompt, hook_event_name: 'PermissionRequest' }).type).toBe('needs_user');
  const input = { ...prompt, hook_event_name: 'PostToolUse', tool_input: { command: 'npm test' } };
  expect(normalizeHook({ ...input, tool_response: { exit_code: 0 } }).type).toBe('task_success');
  expect(normalizeHook({ ...input, tool_response: { exit_code: 1 } }).type).toBe('task_failure');
  expect(normalizeHook({ ...input, tool_response: { output: 'ALL TESTS PASSED token=private' } })).toBeNull();
  expect(normalizeHook({ ...input, tool_input: { command: 'echo test' }, tool_response: { exit_code: 0 } })).toBeNull();
});
it.each(['grep missing file', 'rg missing .', 'test -f absent', 'diff a b', 'git diff --exit-code'])('ignores normal nonzero shell outcomes: %s', command => {
  const input = { ...prompt, tool_input: { command }, tool_response: { exit_code: 1 } };
  expect(normalizeHook({ ...input, hook_event_name: 'PostToolUse' })).toBeNull();
  expect(normalizeHook({ ...input, hook_event_name: 'PostToolUseFailure' })).toBeNull();
});
it('uses Claude success/failure hook semantics without inventing an exit-code field', () => {
  const input = { ...prompt, prompt_id: 'claude-turn', turn_id: undefined, hook_event_name: 'PostToolUse',
    tool_name: 'Bash', tool_input: { command: 'node --test pass.test.mjs' },
    tool_response: { stdout: 'synthetic output', stderr: '', interrupted: false, isImage: false } };
  expect(normalizeHook(input, Date.now(), 'claude').type).toBe('task_success');
  expect(normalizeHook(input)).toBeNull();
  expect(normalizeHook({ ...input, hook_event_name: 'PostToolUseFailure', tool_response: undefined,
    error: 'Exit code 1\n synthetic failure' }, Date.now(), 'claude').type).toBe('task_failure');
  expect(normalizeHook({ ...input, tool_response: { ...input.tool_response, interrupted: true } }, Date.now(), 'claude')).toBeNull();
  expect(normalizeHook({ ...input, tool_input: { command: 'npm test; grep missing file' }, tool_response: { exit_code: 1 } })).toBeNull();
});
it('merges hook configuration idempotently without replacing other integrations or preferences', () => {
  const original = { model: 'existing', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'my-harness check' }] }] } };
  const first = hookConfiguration(original, 'codex');
  expect(hookConfiguration(first, 'codex')).toEqual(first);
  expect(first.hooks.Stop[0]).toEqual(original.hooks.Stop[0]);
  expect(first.model).toBe('existing'); expect(original.hooks.UserPromptSubmit).toBeUndefined();
  expect(first.hooks.UserPromptSubmit[0].hooks[0].commandWindows).toContain('if defined HERDR_PANE_ID');
  expect(hookConfiguration({}, 'claude').hooks.PostToolUseFailure).toHaveLength(1);
  expect(() => hookConfiguration([], 'codex')).toThrow('invalid_hook_config');
});
it('preserves fragmented UTF-8 input and bounds oversized stdin without forwarding', async () => {
  const bytes = Buffer.from(JSON.stringify(prompt)), pieces = Array.from(bytes, byte => Buffer.from([byte]));
  let received;
  await readHook(Readable.from(pieces), async value => { received = value; });
  expect(received.prompt).toBe('Cảm ơn bạn!'); received = undefined;
  await readHook(Readable.from([Buffer.alloc(1048577)]), async value => { received = value; });
  expect(received).toBeUndefined();
});
it('supports repeated legacy prompts without guessing which turn a legacy tool result belongs to', () => {
  const legacy = { ...prompt, turn_id: undefined };
  expect(normalizeHook(legacy).id).not.toBe(normalizeHook(legacy).id);
  expect(normalizeHook({ ...legacy, hook_event_name: 'Stop' })).toBeNull();
});
it('fails closed on malformed settings without overwriting them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fisch-hooks-')), file = join(home, 'settings.json');
  try {
    writeFileSync(file, '{broken');
    expect((await installInteractionHooks({ agent: 'claude' }, { env: { CLAUDE_CONFIG_DIR: home } })).installed).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  } finally { rmSync(file); rmdirSync(home); }
});
it('keeps launch inspection read-only and explicitly installs a standalone runner with reversible hooks', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fisch-managed-')), options = { home, env: {} };
  try {
    expect(inspectInteractionHooks({ agent: 'codex' }, options).installed).toBe(false);
    const installed = await installInteractionHooks({ agent: 'codex' }, options);
    expect(installed.installed).toBe(true);
    const paths = hookPaths('codex', options), bundle = readFileSync(paths.runner, 'utf8');
    expect(bundle).not.toContain("from '../integrations/");
    const configuration = JSON.parse(readFileSync(paths.config, 'utf8'));
    configuration.model = 'preserve';
    configuration.hooks.Stop.push({ hooks: [{ type: 'command', command: 'my-harness check' }] });
    writeFileSync(paths.config, JSON.stringify(configuration));
    expect(uninstallInteractionHooks('codex', options).status).toBe('uninstalled');
    const remaining = JSON.parse(readFileSync(paths.config, 'utf8'));
    expect(remaining.model).toBe('preserve'); expect(remaining.hooks.Stop).toHaveLength(1);
    expect(inspectInteractionHooks({ agent: 'codex' }, options).installed).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it('never starts Node outside Herdr, including when the installed runner path contains spaces', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fisch hook gate-')), runner = join(directory, 'hook.mjs'), marker = join(directory, 'marker');
  const win = process.platform === 'win32';
  writeFileSync(runner, '');
  writeFileSync(join(directory, win ? 'node.cmd' : 'node'), win ? '@echo invoked> "%FISCH_TEST_MARKER%"' : '#!/bin/sh\nprintf invoked > "$FISCH_TEST_MARKER"\n', { mode: 0o700 });
  const handler = hookConfiguration({}, 'codex', runner).hooks.UserPromptSubmit[0].hooks[0];
  const env = { ...process.env, PATH: directory + (win ? ';' : ':') + process.env.PATH, FISCH_TEST_MARKER: marker };
  delete env.HERDR_SOCKET_PATH; delete env.HERDR_PANE_ID;
  const command = win ? handler.commandWindows : handler.command;
  const run = values => promisify(execFile)(win ? 'powershell.exe' : 'sh', win ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command], { env: values, windowsHide: true });
  try {
    await run(env); expect(existsSync(marker)).toBe(false);
    await run({ ...env, HERDR_SOCKET_PATH: 'test', HERDR_PANE_ID: 'test' }); expect(existsSync(marker)).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it('forwards privately to the originating pane and remains silent when no body exists', async () => {
  let received;
  await forwardHook(prompt, async (...args) => { received = args; }, { HERDR_SOCKET_PATH: 'private', HERDR_PANE_ID: 'pane' });
  expect(received[0]).toBe('event'); expect(received[2]).toBe('pane'); expect(received[3]).toBe(500);
  await expect(forwardHook(prompt, async () => { throw Error('offline'); }, { HERDR_SOCKET_PATH: 'x', HERDR_PANE_ID: 'p' })).resolves.toBeUndefined();
  await forwardHook(prompt, () => { throw Error('should not run'); }, {});
});
it('delivers hook stdin through a real child process and private IPC without chat output', async () => {
  const previous = process.env.HERDR_SOCKET_PATH;
  process.env.HERDR_SOCKET_PATH = 'hook-test-' + randomUUID();
  let received; const pane = randomUUID();
  const server = await openControl(pane, message => { received = message; return { status: 'accepted' }; });
  try {
    const child = spawn(process.execPath, ['scripts/fisch-hook.mjs'], { env: { ...process.env, HERDR_PANE_ID: pane },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    Readable.from([JSON.stringify(prompt)]).pipe(child.stdin);
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('hook failed'))); });
    expect(output).toBe(''); expect(received).toMatchObject({ method: 'event', args: { type: 'user_message', text: prompt.prompt } });
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.HERDR_SOCKET_PATH; else process.env.HERDR_SOCKET_PATH = previous;
  }
});
