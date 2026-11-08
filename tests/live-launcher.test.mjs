import { expect, it } from 'vitest';
import { liveCodexArguments } from '../scripts/live-codex.mjs';
import { selectLiveSource } from '../scripts/live-session.mjs';
import { assistantText, OutputActivity } from '../integrations/output-activity.mjs';
import { createLivePane } from '../integrations/live-launch.mjs';

it('keeps credentials in inherited environment, never command arguments or a new prompt', () => {
  const args = liveCodexArguments(process.cwd());
  expect(args).toContain('--no-daemon');
  expect(args).toContain('mcp_servers.fisch_live.env_vars=["AER_BASE_URL","AER_PAIRING_TOKEN","FISCH_LIVE"]');
  expect(args.some(value => value.includes('Read aer://'))).toBe(false);
  expect(() => selectLiveSource({ agents: [{ agent: 'codex' }, { agent: 'codex' }] })).toThrow('Choose one');
});
it('injects pairing values only into a new pane environment and preserves the old pane', async () => {
  const calls = [];
  const call = async (method, params) => {
    calls.push({ method, params });
    if (method === 'tab.create') return { tab: { tab_id: 'new' } };
    if (method === 'session.snapshot') return { snapshot: { panes: [{ pane_id: 'new-pane', tab_id: 'new' }] } };
    return {};
  };
  await createLivePane(call, { pane_id: 'old-pane', workspace_id: 'workspace' }, 'http://127.0.0.1:1234', 'private');
  expect(calls[0].params.env.AER_PAIRING_TOKEN).toBe('private');
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
