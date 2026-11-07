import net from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { sendControl } from './terminal-ipc.mjs';

export function socketAddress(path, platform = process.platform) {
  if (!path) throw Object.assign(Error('Run Fisch in a Herdr pane next to an existing Codex or Claude session.'), { public: true });
  return platform === 'win32' && !path.startsWith('\\\\.\\pipe\\') ? '\\\\.\\pipe\\' + path : path;
}
export function herdrCall(method, params = {}, path = process.env.HERDR_SOCKET_PATH) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const socket = net.connect(socketAddress(path), () => socket.write(JSON.stringify({ id: 'fisch', method, params }) + '\n'));
    const fail = error => { socket.destroy(); reject(error); };
    socket.setTimeout(3500, () => fail(Error('Herdr request timed out.')));
    socket.on('error', fail);
    socket.on('end', () => reject(Error('Herdr closed the connection.')));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 2_000_000) return fail(Error('Herdr response exceeds the frame budget.'));
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      try {
        const message = JSON.parse(buffer.slice(0, end)); socket.destroy();
        if (message.error) reject(Object.assign(Error(message.error.message), { code: message.error.code }));
        else resolve(message.result);
      } catch (error) { fail(error); }
    });
  });
}
const normalized = value => String(value ?? '').replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
export function selectAgent(snapshot, paneId, requested) {
  const own = snapshot.panes.find(pane => pane.pane_id === paneId);
  if (!own) throw Object.assign(Error('Fisch must run inside a live Herdr pane.'), { public: true });
  let peers = snapshot.agents.filter(agent => ['codex', 'claude', 'claude-code'].includes(agent.agent) &&
    agent.pane_id !== paneId && agent.workspace_id === own.workspace_id);
  if (requested) peers = peers.filter(agent => agent.pane_id === requested);
  else {
    const tab = peers.filter(agent => agent.tab_id === own.tab_id);
    if (tab.length) peers = tab;
    const directory = peers.filter(agent => normalized(agent.cwd) === normalized(own.cwd));
    if (directory.length) peers = directory;
  }
  if (peers.length !== 1) throw Object.assign(Error(peers.length
    ? 'Several agents match. Use fisch run --agent <pane-id> to choose explicitly.'
    : 'No existing Codex or Claude agent found next to this pane.'), { public: true });
  return { own, agent: peers[0] };
}
export async function graphicsMode(call = herdrCall) {
  try { await call('pane.graphics.info', { pane_id: process.env.HERDR_PANE_ID }); return 'pixels'; }
  catch (error) {
    if (error.code !== 'feature_disabled') return 'braille';
    const file = process.env.HERDR_CONFIG_PATH ?? (process.platform === 'win32'
      ? join(process.env.APPDATA, 'herdr/config.toml') : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'herdr/config.toml'));
    let text = readFileSync(file, 'utf8');
    if (/^\[experimental\]/m.test(text)) {
      text = text.replace(/(^\[experimental\][\s\S]*?)(?=^\[|(?![\s\S]))/m, section =>
        /^kitty_graphics\s*=/m.test(section) ? section.replace(/^kitty_graphics\s*=.*$/m, 'kitty_graphics = true') : section + '\nkitty_graphics = true\n');
    } else text += '\n[experimental]\nkitty_graphics = true\n';
    writeFileSync(file, text);
    await call('server.reload_config');
    try { await call('pane.graphics.info', { pane_id: process.env.HERDR_PANE_ID }); return 'pixels'; }
    catch { return 'braille'; }
  }
}
export async function paneDoctor() {
  try {
    const attached = await sendControl('status').catch(() => null);
    if (attached) return [{ name: 'Pane attachment', ok: true,
      detail: `${attached.agent} ${attached.agentPane} → ${attached.rendererPane} (${attached.renderer})` },
      { name: 'Interaction hooks', ok: attached.interactionHooks?.delivery === 'live',
        detail: attached.interactionHooks?.delivery === 'live' ? 'Receiving real agent events.' :
          attached.interactionHooks?.installed ? 'Waiting for real events; Codex: review Fisch in /hooks. Claude: reload hooks if required.' : 'Hook installation failed; inspect agent configuration permissions.' }];
    const { snapshot } = await herdrCall('session.snapshot');
    selectAgent(snapshot, process.env.HERDR_PANE_ID);
    return [{ name: 'Herdr', ok: true, detail: snapshot.version },
      { name: 'Agent', ok: true, detail: 'Existing Codex/Claude session found; no new agent or browser needed.' }];
  } catch (error) { return [{ name: 'Pane attachment', ok: false, detail: error.message }]; }
}
