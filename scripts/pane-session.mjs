import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { herdrCall, selectAgent, graphicsMode } from '../integrations/herdr.mjs';
import { openControl } from '../integrations/terminal-ipc.mjs';
import { displaySize, drawFrame } from '../integrations/pane-display.mjs';
import { AgentEventHook } from '../integrations/agent-hooks.mjs';
import { paneActivity } from '../integrations/planner-bridge.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function bundler() {
  try { return await import('esbuild'); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    const script = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    await new Promise((resolve, reject) => {
      const child = existsSync(script) ? spawn(process.execPath, [script, 'ci'], { cwd: root, stdio: 'inherit', windowsHide: true })
        : spawn('npm', ['ci'], { cwd: root, stdio: 'inherit', windowsHide: true });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('Fisch dependency installation failed.')));
    });
    return import('esbuild');
  }
}
export async function terminalEngine() {
  const { build } = await bundler();
  mkdirSync(resolve(root, '.runtime'), { recursive: true });
  const outfile = resolve(root, `.runtime/terminal-${randomUUID()}.mjs`);
  try {
    await build({ entryPoints: [resolve(root, 'src/terminal/runtime.ts')], outfile,
      bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external' });
    const { TerminalEngine } = await import(pathToFileURL(outfile).href);
    return new TerminalEngine();
  } finally { rmSync(outfile, { force: true }); }
}
export function capabilities() {
  return { capabilities: JSON.parse(readFileSync(resolve(root, 'src/contracts/capabilities.json'), 'utf8')),
    schema: JSON.parse(readFileSync(resolve(root, 'src/contracts/protocol.schema.json'), 'utf8')),
    instructions: readFileSync(resolve(root, 'integrations/instructions-v1.md'), 'utf8') };
}
export async function runPaneSession({ agentPane, call = herdrCall, subscribe = (id, update) => new AgentEventHook(id, update), output = process.stdout, signal } = {}) {
  let { snapshot } = await call('session.snapshot');
  const { own, agent } = selectAgent(snapshot, process.env.HERDR_PANE_ID, agentPane);
  let mode = await graphicsMode(call);
  const engine = await terminalEngine();
  const abort = new AbortController(), stop = () => abort.abort();
  const activity = paneActivity(engine, agent, call);
  let commands = 0, frames = 0;
  const control = await openControl(agent.pane_id, message => {
    if (message.method === 'express') { commands++; return activity.express(message.args); }
    if (message.method === 'cancel') return activity.cancel();
    if (message.method === 'stop') { stop(); return { status: 'stopped' }; }
    if (message.method === 'status') return { status: 'attached', agent: agent.agent, agentPane: agent.pane_id,
      rendererPane: own.pane_id, renderer: mode, frames, expressions: commands, shape: engine.state.shape,
      integration: 'automatic-hooks', activity: activity.status, transitions: activity.transitions,
      eventsConnected: events.connected, bodySource: activity.source, planner: activity.planner };
    throw Error('unknown_method');
  });
  const events = subscribe(agent.pane_id, status => activity.update(status));
  activity.update(agent.agent_status ?? 'unknown');
  process.once('SIGINT', stop); process.once('SIGTERM', stop); signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const wasRaw = process.stdin.isRaw ?? false;
  const key = chunk => { if (chunk.includes(113) || chunk.includes(3)) stop(); };
  if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', key); }
  output.write('\x1b[?1049h\x1b[?25l\x1b[2J');
  try {
    while (!abort.signal.aborted) {
      if (frames % 10 === 0) {
        snapshot = (await call('session.snapshot')).snapshot;
        if (!snapshot.panes.some(pane => pane.pane_id === own.pane_id) ||
            !snapshot.agents.some(peer => peer.pane_id === agent.pane_id && peer.agent === agent.agent)) break;
        if (mode === 'braille' && frames > 0) mode = await graphicsMode(call);
        activity.update(snapshot.agents.find(peer => peer.pane_id === agent.pane_id).agent_status ?? 'unknown');
      }
      activity.tick(); const size = displaySize(snapshot, own.pane_id), pixels = engine.frame(size.width, size.height);
      await drawFrame({ pixels, size, mode, paneId: own.pane_id, call, output,
        title: `Fisch · ${activity.status} · body: ${activity.source} · planner: ${activity.planner.mode}` });
      frames++; await delay(100);
    }
    return 0;
  } finally {
    stop(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    signal?.removeEventListener('abort', stop); process.stdin.off('data', key);
    if (process.stdin.isTTY) { process.stdin.setRawMode(wasRaw); process.stdin.pause(); }
    if (mode === 'pixels') await call('pane.graphics.clear', { pane_id: own.pane_id }).catch(() => {});
    events.close(); activity.close(); await control.close(); engine.dispose(); output.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  }
}
