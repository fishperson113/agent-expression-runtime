import { expect, it } from 'vitest';
import { liveCodexArguments } from '../scripts/live-codex.mjs';
import { selectLiveSource, liveControl } from '../scripts/live-session.mjs';
import { assistantText, OutputActivity } from '../integrations/output-activity.mjs';
import { createLivePane } from '../integrations/live-launch.mjs';

it('keeps credentials in inherited environment, never command arguments or a new prompt', () => {
  const args = liveCodexArguments(process.cwd());
  expect(args).toContain('--no-daemon');
  expect(args).toContain('mcp_servers.fisch_live.env_vars=["AER_BASE_URL","AER_PAIRING_TOKEN","FISCH_LIVE"]');
  expect(args.some(value => value.includes('Read aer://'))).toBe(false);
  expect(() => selectLiveSource({ agents: [{ agent: 'codex' }, { agent: 'codex' }] })).toThrow('Open a Herdr shell');
});
it('uses the calling shell workspace without needing an existing agent or pane argument', () => {
  const shell = { pane_id: 'shell', workspace_id: 'workspace', cwd: 'C:/project' };
  const other = { agent: 'codex', pane_id: 'elsewhere' };
  expect(selectLiveSource({ agents: [], panes: [shell] }, undefined, 'shell')).toBe(shell);
  expect(selectLiveSource({ agents: [other, { agent: 'codex' }], panes: [shell] }, undefined, 'shell')).toBe(shell);
  expect(selectLiveSource({ agents: [], panes: [shell], focused_pane_id: 'shell' })).toBe(shell);
  expect(selectLiveSource({ agents: [other], panes: [shell] }, 'elsewhere', 'shell')).toBe(other);
});
it('injects pairing values only into a new pane environment and preserves the old pane', async () => {
  const calls = [];
  const call = async (method, params) => {
    calls.push({ method, params });
    if (method === 'tab.create') return { tab: { tab_id: 'new' } };
    if (method === 'session.snapshot') return { snapshot: { panes: [{ pane_id: 'new-pane', tab_id: 'new' }] } };
    return {};
  };
  await createLivePane(call, { pane_id: 'old-pane', workspace_id: 'workspace', cwd: 'C:/workspace/user-project' }, 'http://127.0.0.1:1234', 'private');
  expect(calls[0].params.env.AER_PAIRING_TOKEN).toBe('private');
  expect(calls[0].params.cwd).toBe('C:/workspace/user-project');
  expect(calls[0].params.env.FISCH_LIVE_WORKSPACE).toBe('C:/workspace/user-project');
  expect(calls.at(-1).params.text).not.toContain('private');
  expect(calls.at(-1).params.pane_id).toBe('new-pane');
});
it('ignores TUI redraw/tool/spinner changes and decays approximate assistant activity within 600ms', () => {
  const activity = new OutputActivity();
  expect(assistantText('• Ran npm test\n└ logs\n⠋ working')).toBe('');
  expect(activity.sample('• Xin', 0)).toBe(0);
  expect(activity.sample('• Xin chào', 100)).toBeGreaterThan(0);
  expect(activity.sample('• Xin chào', 700)).toBe(0);
  expect(activity.sample('• Xin chào\n• Ran npm test\n└ pass', 800)).toBe(0);
});
it('forwards only lifecycle type, never prompt text, to the browser', async () => {
  const forwarded = [], handler = liveControl({ page: { evaluate: async (_callback, type) => forwarded.push(type) } }, () => {});
  await handler({ method: 'event', args: { type: 'user_message', text: 'private words' } });
  expect(forwarded).toEqual(['user_message']);
  expect((await handler({ method: 'status' })).hookEvents).toBe(1);
  expect((await handler({ method: 'event', args: { type: 'tool_text' } })).status).toBe('ignored');
});
