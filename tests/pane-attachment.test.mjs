import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { socketAddress, selectAgent } from '../integrations/herdr.mjs';
import { runPaneSession } from '../scripts/pane-session.mjs';
import { openControl, sendControl, controlAddress } from '../integrations/terminal-ipc.mjs';
import { brailleFrame } from '../integrations/pane-display.mjs';

const own = { pane_id: 'w1:p2', workspace_id: 'w1', tab_id: 'w1:t1', cwd: '/project' };
const codex = { ...own, pane_id: 'w1:p1', agent: 'codex' };
it.each(['codex', 'claude'])('discovers existing %s in the same tab, excluding the renderer pane', provider => {
  const agent = { ...codex, agent: provider };
  expect(selectAgent({ panes: [own], agents: [{ ...own, agent: 'codex' }, agent] }, own.pane_id).agent).toBe(agent);
});
it('does not choose another workspace or silently choose between multiple agents', () => {
  const snapshot = { panes: [own], agents: [{ ...codex, workspace_id: 'other' }] };
  expect(() => selectAgent(snapshot, own.pane_id)).toThrow('No existing');
  snapshot.agents = [codex, { ...codex, pane_id: 'w1:p3', agent: 'claude' }];
  expect(() => selectAgent(snapshot, own.pane_id)).toThrow('Several agents');
  expect(selectAgent(snapshot, own.pane_id, 'w1:p3').agent.agent).toBe('claude');
});
it('uses platform-native local sockets without putting credentials in discovery files', () => {
  expect(socketAddress('C:\\herdr.sock', 'win32')).toBe('\\\\.\\pipe\\C:\\herdr.sock');
  expect(socketAddress('/tmp/herdr.sock', 'linux')).toBe('/tmp/herdr.sock');
  expect(controlAddress('pane', 'namespace', 'win32')).toMatch(/^\\\\.\\pipe\\fisch-/);
});
it('binds requests to the existing agent pane and preserves structured errors', async () => {
  const namespace = process.env.HERDR_SOCKET_PATH;
  process.env.HERDR_SOCKET_PATH = 'test-' + randomUUID();
  const id = 'agent-' + randomUUID();
  const server = await openControl(id, message => {
    if (message.method === 'bad') throw Object.assign(Error('range'), { code: 'range', path: '$.body.durationMs' });
    return { status: 'accepted', body: message.args };
  });
  try {
    await expect(openControl(id, () => ({}))).rejects.toThrow();
    expect(await sendControl('express', { type: 'wait', durationMs: 1 }, id)).toMatchObject({ status: 'accepted' });
    expect(await sendControl('bad', {}, id)).toMatchObject({ status: 'rejected', path: '$.body.durationMs' });
    await expect(sendControl('status', {}, id + '-other')).rejects.toThrow('No Fisch body');
  } finally {
    await server.close();
    if (namespace === undefined) delete process.env.HERDR_SOCKET_PATH; else process.env.HERDR_SOCKET_PATH = namespace;
  }
});
it('renders actual RGB particles into pane text when the client cannot display inline pixels', () => {
  const pixels = Buffer.alloc(2 * 4 * 3);
  pixels[1] = 255;
  expect(brailleFrame(pixels, 2, 4, 1, 1)).toBe('\u2801');
});
it('attaches to the existing agent, retries a blocked notice and releases control on stop', async () => {
  const previous = { socket: process.env.HERDR_SOCKET_PATH, pane: process.env.HERDR_PANE_ID };
  process.env.HERDR_SOCKET_PATH = 'lifecycle-' + randomUUID();
  process.env.HERDR_PANE_ID = own.pane_id;
  const snapshot = { panes: [own], agents: [codex], layouts: [] };
  let notices = 0, rendered = 0;
  const call = async (method, args) => {
    if (method === 'session.snapshot') return { snapshot };
    if (method === 'pane.graphics.info') throw Object.assign(Error('unavailable'), { code: 'cell_size_unavailable' });
    expect(method).toBe('agent.prompt'); expect(args.target).toBe(codex.pane_id);
    if (++notices === 1) throw Object.assign(Error('blocked'), { code: 'agent_blocked' });
    expect(args.text).toContain('EXISTING');
    expect(await sendControl('express', { body: { type: 'morph', target: 'wall', durationMs: 1 } }, codex.pane_id))
      .toMatchObject({ status: 'accepted' });
    expect(await sendControl('status', {}, codex.pane_id)).toMatchObject({ agentPane: codex.pane_id, expressions: 1 });
    await sendControl('stop', {}, codex.pane_id);
  };
  try {
    expect(await runPaneSession({ call, output: { write() { rendered++; } } })).toBe(0);
    expect(notices).toBe(2); expect(rendered).toBeGreaterThan(3);
    await expect(sendControl('status', {}, codex.pane_id)).rejects.toThrow('No Fisch body');
  } finally {
    for (const [key, value] of [['HERDR_SOCKET_PATH', previous.socket], ['HERDR_PANE_ID', previous.pane]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
