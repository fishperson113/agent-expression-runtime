import { expect, it } from 'vitest';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentEventHook, activityHook } from '../integrations/agent-hooks.mjs';
import { terminalEngine } from '../scripts/pane-session.mjs';

it('turns lifecycle changes into accepted runtime programs without agent tools', async () => {
  const engine = await terminalEngine(), hook = activityHook(engine);
  try {
    for (const status of ['working', 'blocked', 'done', 'idle', 'unknown']) {
      expect(hook.update(status)).toBe(true);
      expect(hook.update(status)).toBe(false);
      engine.frame(128, 96);
    }
    expect(hook.update('unsupported')).toBe(false);
    expect(hook.transitions).toBe(5);
  } finally { engine.dispose(); }
});
it('builds independent engines concurrently for multiple Fisch panes', async () => {
  const engines = await Promise.all([terminalEngine(), terminalEngine(), terminalEngine()]);
  try {
    for (const engine of engines) expect(activityHook(engine).update('working')).toBe(true);
  } finally { for (const engine of engines) engine.dispose(); }
});
it('filters the real subscription protocol, handles fragmented records and reconnects', async () => {
  const path = process.platform === 'win32' ? '\\\\.\\pipe\\fisch-hook-test-' + randomUUID()
    : join(tmpdir(), 'fisch-hook-' + randomUUID() + '.sock');
  let connections = 0;
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    socket.once('data', data => {
      const request = JSON.parse(data);
      expect(request.params.subscriptions).toEqual([{ type: 'pane.agent_status_changed', pane_id: 'agent' }]);
      connections++;
      socket.write('{"id":"fisch-hooks","result":{"type":"subscription_started"}}\n');
      socket.write('{"event":"pane.agent_status_changed","data":{"pane_id":"other","agent_status":"blocked"}}\n');
      const event = JSON.stringify({ event: 'pane.agent_status_changed', data: { pane_id: 'agent', agent_status: 'working' } });
      socket.write(event.slice(0, 20)); socket.end(event.slice(20) + '\n');
    });
  });
  await new Promise(resolve => server.listen(path, resolve));
  const statuses = [], hook = new AgentEventHook('agent', status => statuses.push(status), path);
  try {
    for (let i = 0; i < 120 && statuses.length < 2; i++) await delay(25);
    expect(connections).toBeGreaterThanOrEqual(2);
    expect(statuses).toEqual(['working', 'working']);
  } finally { hook.close(); await new Promise(resolve => server.close(resolve)); }
  const count = connections; await delay(300); expect(connections).toBe(count);
});
