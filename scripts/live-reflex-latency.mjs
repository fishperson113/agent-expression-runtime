import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { openLive, closeLiveResources } from '../integrations/live-launch.mjs';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';

const declared = process.argv.includes('--declared-pose');
const trials = Number(process.env.FISCH_LATENCY_TRIALS ?? 10);
if (!Number.isInteger(trials) || trials < 1 || trials > 30) throw Error('Invalid latency trial count');
const live = await openLive({ headless: !process.argv.includes('--headed'), synthetic: true });
const results = []; let client;
function installMeter() {
  clearInterval(window.absentInterval);
  const canvas = document.getElementById('body'), gl = canvas.getContext('webgl2');
  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4), original = gl.drawArrays.bind(gl);
  const meter = window.reflexMeter = { confirmedAt: null, motionMs: null, before: null, previous: null,
    baselineOrigin: null, maxPreEventJitterPixels: 0, observedFrames: 0, centroidDeltaPixels: null };
  gl.drawArrays = (...args) => {
    original(...args); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let mass = 0, sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const weight = Math.max(0, pixels[i + 1] - 24); mass += weight;
      sum += weight * Math.floor(i / 4 / gl.drawingBufferWidth);
    }
    if (!mass) return;
    const center = sum / mass; meter.observedFrames++;
    if (meter.confirmedAt === null) {
      meter.baselineOrigin ??= center;
      meter.maxPreEventJitterPixels = Math.max(meter.maxPreEventJitterPixels, Math.abs(center - meter.baselineOrigin));
    } else if (meter.motionMs === null && Math.abs(center - meter.before) > 2) {
      meter.motionMs = performance.now() - meter.confirmedAt; meter.centroidDeltaPixels = center - meter.before;
    }
    meter.previous = center;
  };
  const observer = new MutationObserver(() => {
    if (meter.confirmedAt === null && document.getElementById('events').firstElementChild?.textContent.endsWith('/ user_arrived')) {
      meter.confirmedAt = meter.lastFixtureAt; meter.before = meter.previous;
    }
  });
  observer.observe(document.getElementById('events'), { childList: true, subtree: true });
  const timer = setInterval(() => { meter.lastFixtureAt = performance.now(); window.fischLive.fixture('present'); }, 1000 / 24);
  window.cleanupReflexMeter = () => { clearInterval(timer); observer.disconnect(); gl.drawArrays = original; };
}
async function prepareTrial(trial) {
  if (trial) {
    await live.page.reload();
    await live.page.waitForFunction(() => document.getElementById('connection').textContent.includes('Đã nối'));
  }
  if (declared) {
    await client?.close(); client = liveTestClient(live.base, live.token); await client.call('initialize');
    toolValue(await client.tool('express', { body: { type: 'live', program: null, configuration: {
    controls: [{ type: 'reflex', id: 'latency_probe', when: { event: 'user_arrived' }, do: {
      type: 'pose', target: { part: 'body', prop: 'y' }, value: 0.3, durationMs: 600 }, cooldownMs: 10000 }],
    poses: [], lifetimeMs: 60000 } } }));
  }
  await live.page.evaluate(() => { window.absentInterval = setInterval(() => window.fischLive.fixture('absent'), 1000 / 24); });
  await delay(2100);
}
function readResult() {
  const m = window.reflexMeter;
  return { confirmedEventToCentroidChangeMs: m.motionMs, centroidDeltaPixels: m.centroidDeltaPixels,
    maxPreEventJitterPixels: m.maxPreEventJitterPixels, observedFrames: m.observedFrames,
    cameraUsed: window.fischLive.metrics().cameraActive, validNoiseFloor: m.maxPreEventJitterPixels < 2 };
}
try {
  mkdirSync('.runtime', { recursive: true });
  for (let trial = 0; trial < trials; trial++) {
    await prepareTrial(trial); await live.page.evaluate(installMeter);
    try {
      await live.page.waitForFunction(() => window.reflexMeter.motionMs !== null, null, { timeout: 5000 });
      const result = await live.page.evaluate(readResult); results.push(result); console.log(JSON.stringify({ trial, ...result }));
      if (result.cameraUsed) throw Error('Unexpected physical camera activity');
    } finally { await live.page.evaluate(() => window.cleanupReflexMeter?.()); }
    writeFileSync('.runtime/live-reflex-latency.json', JSON.stringify({ declaredPose: declared, trials: results,
      modelCalls: 0, pixelsPersisted: false, method: 'Fresh page/default cooldown each trial; 24 Hz synthetic observations; >2px green-weighted WebGL centroid shift; debounce excluded, readback included' }, null, 2));
  }
} finally { await closeLiveResources([() => client?.close(), () => live.close()]); }
