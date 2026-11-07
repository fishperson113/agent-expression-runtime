import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { terminalEngine } from './pane-session.mjs';
import { paneActivity } from '../integrations/planner-bridge.mjs';
import { openControl } from '../integrations/terminal-ipc.mjs';

function png(pixels, width, height) {
  const chunk = (type, data) => {
    const payload = Buffer.concat([Buffer.from(type), data]), head = Buffer.alloc(4), tail = Buffer.alloc(4);
    head.writeUInt32BE(data.length); tail.writeUInt32BE(crc32(payload)); return Buffer.concat([head, payload, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
async function sendFixture(pane, name, prompt) {
  const child = spawn(process.execPath, ['scripts/fisch-hook.mjs'], { env: { ...process.env, HERDR_PANE_ID: pane },
    stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  child.stdin.end(JSON.stringify({ session_id: 'synthetic-evaluation', turn_id: name, hook_event_name: 'UserPromptSubmit', prompt }));
  await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('hook_failed')));
  });
}
async function scenario(activity, engine, pane, name, prompt) {
  const before = activity.planner.applied, start = performance.now();
  await sendFixture(pane, name, prompt);
  if (activity.source !== 'listening') throw Error('missing_attention');
  const attentionMs = performance.now() - start;
  while (activity.planner.applied === before && performance.now() - start < 50000) {
    activity.tick(); engine.frame(384, 256); await delay(50);
    if (activity.planner.error) throw Error(activity.planner.error);
  }
  if (activity.planner.applied !== before + 1) throw Error('missing_reaction');
  const inferenceMs = performance.now() - start;
  for (let i = 0; i < 72; i++) { engine.frame(384, 256); await delay(33); }
  const image = `docs/evidence/reaction-${name}.png`;
  writeFileSync(image, png(engine.renderer.pixels, 384, 256));
  return { name, syntheticUserMessage: prompt, attentionMs, inferenceMs, image,
    reaction: activity.planner.lastReaction, concept: activity.planner.lastConcept, body: activity.planner.lastPlan };
}
const previous = process.env.HERDR_SOCKET_PATH, pane = randomUUID();
process.env.HERDR_SOCKET_PATH = 'fisch-eval-' + randomUUID();
const engine = await terminalEngine();
const activity = paneActivity(engine, { agent: 'codex' }, () => { throw Error('terminal_reads_forbidden'); },
  { enabled: true, backend: 'codex' });
const control = await openControl(pane, message => activity.event(message.args));
try {
  mkdirSync('docs/evidence', { recursive: true }); activity.update('working');
  const results = [];
  for (const [name, prompt] of [['praise', 'Cảm ơn bạn, làm tốt lắm!'], ['frustration', 'Tôi đang bực vì lỗi này vẫn chưa sửa được.']]) {
    results.push(await scenario(activity, engine, pane, name, prompt));
  }
  const report = { synthetic: true, results, transport: activity.planner.transport,
    realAttachedAgentHookDelivery: 'requires-native-trust-and-next-user-message', humanRecognition: 'not-assessed' };
  writeFileSync('docs/evidence/interaction-smoke.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ results: results.map(({ body, ...summary }) => summary), transport: report.transport }));
} finally {
  activity.close(); engine.dispose(); await control.close();
  if (previous === undefined) delete process.env.HERDR_SOCKET_PATH; else process.env.HERDR_SOCKET_PATH = previous;
}
