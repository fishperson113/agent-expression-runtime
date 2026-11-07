import { expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { plannerCommand, runPlannerProcess, parseProcessPlan } from '../integrations/planner-process.mjs';
import { plannerConfig } from '../integrations/planner-provider.mjs';

it('selects the attached provider by default and leaves external API opt-in', () => {
  const absent = new URL('../.runtime/no-planner-env', import.meta.url);
  expect(plannerConfig({}, absent, { agent: 'claude' }).backend).toBe('claude');
  expect(plannerConfig({}, absent, { agent: 'codex' }).backend).toBe('codex');
  expect(plannerConfig({ OPENAI_API_KEY: 'unused' }, absent, { agent: 'codex' }).backend).toBe('codex');
});
it('uses noninteractive isolated CLI flags and never puts context in arguments', () => {
  const codex = plannerCommand({ backend: 'codex' }, '/schema', '/scratch', {}, 'linux');
  expect(codex.command).toBe('codex');
  expect(codex.args).toContain('--ephemeral'); expect(codex.args).toContain('--ignore-user-config');
  expect(codex.args).toContain('read-only'); expect(codex.args).toContain('hooks');
  expect(codex.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  const claude = plannerCommand({ backend: 'claude' }, '/schema', '/scratch', {}, 'linux');
  expect(claude.args).toContain('--no-session-persistence');
  expect(claude.args[claude.args.indexOf('--tools') + 1]).toBe('');
  expect(() => plannerCommand({ backend: 'codex', command: 'codex.cmd' }, '/s', '/t')).toThrow();
});
it('sends context through stdin to a real background child without multiplexer identity', async () => {
  const script = 'let text="";process.stdin.on("data",c=>text+=c);process.stdin.on("end",()=>console.log(JSON.stringify({input:text,herdr:!!process.env.HERDR_SOCKET_PATH})));';
  const output = await runPlannerProcess(process.execPath, ['-e', script], 'context payload', new AbortController().signal, tmpdir());
  expect(JSON.parse(output)).toEqual({ input: 'context payload', herdr: false });
});
it('terminates a real hanging child on cancellation', async () => {
  const controller = new AbortController();
  const pending = runPlannerProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', controller.signal, tmpdir());
  setTimeout(() => controller.abort(), 30);
  await expect(pending).rejects.toThrow('planner_process_failed');
});
it('parses completed Codex and Claude structured output and rejects partial turns', () => {
  const value = { body: { type: 'sequence', children: [] } };
  const message = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(value) } });
  expect(parseProcessPlan(message + '\n{"type":"turn.completed"}\n', 'codex')).toEqual(value);
  expect(() => parseProcessPlan(message, 'codex')).toThrow('incomplete_plan');
  expect(parseProcessPlan(JSON.stringify({ subtype: 'success', structured_output: value }), 'claude')).toEqual(value);
});
