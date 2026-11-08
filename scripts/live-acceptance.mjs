import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { openLive } from '../integrations/live-launch.mjs';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';

const requireCheck = (condition, name) => { if (!condition) throw Error('acceptance_' + name); };
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor(values.length * fraction)] ?? 0;
async function expression(client, body) {
  const start = performance.now(), result = toolValue(await client.tool('express', { body }));
  requireCheck(result.status === 'accepted', 'expression_admission');
  const elapsed = performance.now() - start; await delay(130); return elapsed;
}
async function lifecycle(client) {
  toolValue(await client.tool('express', { kind: 'define', body: { name: 'liveAcceptance', revision: 1, params: {}, body: { type: 'wait', durationMs: 10 } } }));
  await delay(130); toolValue(await client.tool('cancel_expression'));
  await expression(client, { type: 'call', name: 'liveAcceptance', revision: 1, args: {} });
  const invalid = await client.tool('express', { body: { type: 'live', program: null, configuration: { controls: [], poses: [], lifetimeMs: Infinity } } });
  requireCheck(invalid.isError, 'atomic_invalid_rejection');
}
async function controls(client) {
  return expression(client, { type: 'live', program: { type: 'assemble', durationMs: 300, parts: [
    { id: 'chosen', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.4, 0.7, 0.2] }] },
  configuration: { lifetimeMs: 60000, controls: [{ type: 'bind', id: 'signal', signal: 'agent.output',
    target: { part: 'chosen', prop: 'scaleY' }, gain: 0.5, offset: 1, clamp: [1, 1.5], smoothMs: 80 }], poses: [] } });
}
async function look(client) {
  const result = await client.tool('look', { reason: 'Synthetic-only acceptance' });
  requireCheck(!result.isError && result.content[1]?.type === 'image', 'synthetic_image');
  const again = await client.tool('look', { reason: 'Cooldown acceptance' });
  requireCheck(again.isError && again.content[0].text.includes('look_rate_limited'), 'look_cooldown');
  return { mimeType: result.content[1].mimeType, encodedBytes: result.content[1].data.length, syntheticOnly: true };
}
export async function runAcceptance() {
  const live = await openLive({ headless: true }), errors = []; let client;
  live.page.on('pageerror', error => errors.push(error.message));
  try {
    client = liveTestClient(live.base, live.token); await client.call('initialize');
    const tools = await client.call('tools/list'); requireCheck(['observe', 'look', 'express'].every(name => tools.tools.some(tool => tool.name === name)), 'tools');
    const coldStart = performance.now(); toolValue(await client.tool('observe')); const observeColdMs = performance.now() - coldStart;
    const reads = [], admissions = [];
    for (let i = 0; i < 20; i++) { const start = performance.now(); toolValue(await client.tool('observe')); reads.push(performance.now() - start); }
    admissions.push(await controls(client));
    for (let i = 0; i < 12; i++) admissions.push(await expression(client, { type: 'style', brightness: i % 2 ? 0.8 : 0.6, durationMs: 100 }));
    await lifecycle(client); const image = await look(client);
    const cameraActive = await live.page.locator('video').evaluate(video => !!video.srcObject); requireCheck(!cameraActive, 'camera_off');
    await client.close(); client = undefined; await live.page.reload();
    await live.page.waitForFunction(() => document.getElementById('connection').textContent.includes('Đã nối'));
    client = liveTestClient(live.base, live.token); await client.call('initialize'); toolValue(await client.tool('observe'));
    const report = { checks: 'passed', nativeGateway: true, executionMode: 'headless-software-renderer', realCameraUsed: false, image, observeColdMs,
      observeP50Ms: percentile(reads, 0.5), observeP95Ms: percentile(reads, 0.95), expressP95Ms: percentile(admissions, 0.95),
      macroAfterCancel: true, browserReload: true, scriptErrors: errors.length, metrics: await live.page.evaluate(() => window.fischLive.metrics()) };
    requireCheck(errors.length === 0, 'script_errors'); mkdirSync('.runtime', { recursive: true });
    writeFileSync('.runtime/live-acceptance.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); return report;
  } finally { await client?.close(); await live.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  runAcceptance().catch(error => { console.error(error.message); process.exitCode = 1; });
