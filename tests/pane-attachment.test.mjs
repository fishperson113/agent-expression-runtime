import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { socketAddress, selectAgent } from '../integrations/herdr.mjs';
import { runPaneSession } from '../scripts/pane-session.mjs';
import { openControl, sendControl, controlAddress } from '../integrations/terminal-ipc.mjs';
import { brailleFrame } from '../integrations/pane-display.mjs';
import { normalizeHook } from '../integrations/interaction-events.mjs';

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
it('automatically follows agent events without prompts or expression tool calls and cleans up', async () => {
  const previous = { socket: process.env.HERDR_SOCKET_PATH, pane: process.env.HERDR_PANE_ID, backend: process.env.FISCH_PLANNER_BACKEND };
  process.env.FISCH_PLANNER_BACKEND = 'off';
  process.env.HERDR_SOCKET_PATH = 'lifecycle-' + randomUUID();
  process.env.HERDR_PANE_ID = own.pane_id;
  const snapshot = { panes: [own], agents: [{ ...codex, agent_status: 'working' }], layouts: [] };
  let rendered = 0, closed = false, pending;
  const call = async method => {
    if (method === 'session.snapshot') return { snapshot };
    if (method === 'pane.graphics.info') throw Object.assign(Error('unavailable'), { code: 'cell_size_unavailable' });
    throw Error('Unexpected agent interaction: ' + method);
  };
  const subscribe = (id, update) => {
    expect(id).toBe(codex.pane_id);
    pending = new Promise((resolve, reject) => setImmediate(async () => {
      try {
        update('blocked'); update('blocked'); update('done');
        expect(await sendControl('status', {}, id)).toMatchObject({ integration: 'automatic-hooks',
          activity: 'done', transitions: 3, expressions: 0 });
        const event = normalizeHook({ session_id: 's', turn_id: 't', hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
        expect(await sendControl('event', event, id)).toMatchObject({ status: 'accepted', eventId: event.id });
        expect(await sendControl('status', {}, id)).toMatchObject({ bodySource: 'listening',
          interactionHooks: { delivery: 'live' }, planner: { interactionEvents: 1, attempts: 0 } });
        await sendControl('stop', {}, id); resolve();
      } catch (error) { reject(error); }
    }));
    return { connected: true, close() { closed = true; } };
  };
  try {
    expect(await runPaneSession({ call, subscribe, installHooks: () => ({ installed: true }), output: { write() { rendered++; } } })).toBe(0);
    await pending;
    expect(closed).toBe(true); expect(rendered).toBeGreaterThan(2);
    await expect(sendControl('status', {}, codex.pane_id)).rejects.toThrow('No Fisch body');
  } finally {
    for (const [key, value] of [['HERDR_SOCKET_PATH', previous.socket], ['HERDR_PANE_ID', previous.pane], ['FISCH_PLANNER_BACKEND', previous.backend]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
