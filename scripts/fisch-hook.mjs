import { pathToFileURL } from 'node:url';
import { normalizeHook } from '../integrations/interaction-events.mjs';
import { sendControl } from '../integrations/terminal-ipc.mjs';

export async function forwardHook(input, send = sendControl, env = process.env) {
  if (!env.HERDR_SOCKET_PATH || !env.HERDR_PANE_ID) return;
  const event = normalizeHook(input);
  if (event) await send('event', event, env.HERDR_PANE_ID, 500).catch(() => {});
}
export async function readHook(stream = process.stdin) {
  let buffer = '', overflow = false;
  for await (const chunk of stream) {
    if (Buffer.byteLength(buffer) + chunk.length > 1048576) { overflow = true; buffer = ''; }
    if (!overflow) buffer += chunk;
  }
  if (!overflow) await forwardHook(JSON.parse(buffer));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const timer = setTimeout(() => process.exit(0), 1000);
  try { await readHook(); } catch {} finally { clearTimeout(timer); }
}
