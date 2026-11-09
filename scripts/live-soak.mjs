import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { openLive } from '../integrations/live-launch.mjs';
import { memorySample, egressCounters } from '../integrations/live-measure.mjs';
import { runSoakSampling } from '../integrations/live-soak-sampling.mjs';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';
import { birdParts, peaceParts, sculptureProgram } from '../integrations/sculpture-examples.mjs';

const seconds = Number(process.env.FISCH_SOAK_SECONDS ?? 1800);
const camera = process.argv.includes('--camera-local');
const synthetic = process.argv.includes('--synthetic-camera');
if (camera && synthetic) throw Error('Choose physical local camera or synthetic fixtures, never both');
if (!Number.isFinite(seconds) || seconds < 10 || seconds > 7200) throw Error('Invalid soak duration');
let counts;
const errors = [], samples = [];
const live = await openLive({ headless: !camera, production: true, synthetic,
  inspect: page => { counts = egressCounters(page); page.on('pageerror', error => errors.push(error.message)); } });
let client, cycle = 0;
try {
  client = liveTestClient(live.base, live.token); await client.call('initialize');
  toolValue(await client.tool('express', { body: sculptureProgram(birdParts(), 600) }));
  if (synthetic) await live.page.evaluate(() => {
    const start = performance.now();
    (window).fischSoakFixture = setInterval(() => {
      const phase = Math.floor((performance.now() - start) / 1000) % 60;
      window.fischLive.fixture(phase < 35 ? 'present' : phase < 45 ? 'absent' : phase < 50 ? 'stale' : phase < 55 ? 'denied' : 'error');
    }, 1000 / 24);
  });
  if (camera) {
    await live.page.context().grantPermissions(['camera'], { origin: new URL(live.page.url()).origin });
    await live.page.locator('#camera-start').click();
    try { await live.page.waitForFunction(() => document.getElementById('camera-status').textContent.includes('Camera sẵn sàng'), null, { timeout: 30000 }); }
    catch (error) { console.error(JSON.stringify({ cameraDiagnostics: await live.page.evaluate(() => window.fischLive.metrics()) })); throw error; }
  }
  await delay(60000);
  const cameraInfo = await live.page.locator('video').evaluate(video => ({ width: video.videoWidth, height: video.videoHeight,
    audioTracks: video.srcObject?.getAudioTracks().length ?? 0 }));
  const gpu = await live.page.locator('#body').evaluate(canvas => { const gl = canvas.getContext('webgl2'), info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  const baseline = await memorySample(live.browser, live.page, true), start = performance.now();
  mkdirSync('.runtime', { recursive: true }); console.log(JSON.stringify({ soak: 'started', seconds, cameraLocalOnly: camera, baseline }));
  const sampling = await runSoakSampling({ start, durationMs: seconds * 1000, intervalMs: 30000,
    now: () => performance.now(), wait: delay }, async elapsedMs => {
    const elapsedSeconds = elapsedMs / 1000;
    const sample = { elapsedSeconds, memory: await memorySample(live.browser, live.page),
      metrics: await live.page.evaluate(() => window.fischLive.metrics()), vision: await live.page.locator('#vision-metrics').textContent() };
    toolValue(await client.tool('observe'));
    if (Math.floor(elapsedSeconds / 120) > cycle) {
      cycle = Math.floor(elapsedSeconds / 120); toolValue(await client.tool('cancel_expression'));
      toolValue(await client.tool('express', { body: sculptureProgram(cycle % 2 ? peaceParts() : birdParts(), 600) }));
      await live.page.setViewportSize({ width: cycle % 2 ? 1100 : 1360, height: 950 });
    }
    samples.push(sample); writeFileSync('.runtime/live-soak.progress.json', JSON.stringify({ elapsedSeconds, sample, counts, errors }, null, 2));
    if (camera && (!sample.metrics.cameraActive || !['tracking', 'absent'].includes(sample.metrics.camera))) throw Error('Camera stopped during soak: ' + JSON.stringify(sample.metrics.cameraTransitions));
  });
  const final = await memorySample(live.browser, live.page, true);
  const report = { durationSeconds: (performance.now() - start) / 1000, requestedDurationSeconds: seconds,
    sampledDurationSeconds: sampling.sampledDurationMs / 1000, warmupSeconds: 60, cameraLocalOnly: camera,
    syntheticFixture: synthetic, executionMode: camera ? 'physical-camera' : 'headless-software-renderer',
    inferenceRateMeasured: false, soakDurationEligible: seconds >= 1800 && sampling.sampledDurationMs >= seconds * 1000, cameraInfo, gpu,
    baseline, final, heapGrowthBytes: final.heapBytes - baseline.heapBytes,
    privateGrowthBytes: final.privateBytes === null ? null : final.privateBytes - baseline.privateBytes,
    counts, errors, topologyCancelResizeCycles: cycle, automatedModelPrompts: 0,
    cameraContinuous: camera ? samples.every(sample => sample.metrics.cameraActive && ['tracking', 'absent'].includes(sample.metrics.camera)) : null,
    privateMemoryGate: final.privateBytes === null || baseline.privateBytes === null ? 'unknown' : final.privateBytes - baseline.privateBytes < 100000000 ? 'passed' : 'failed', samples };
  writeFileSync('.runtime/live-soak.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, samples: samples.length }));
  if (errors.length || counts.unexpectedFrames || counts.nonLoopbackRequests || (report.privateGrowthBytes ?? 0) > 100000000) process.exitCode = 1;
} finally {
  if (synthetic && !live.page.isClosed()) await live.page.evaluate(() => clearInterval(window.fischSoakFixture)).catch(() => {});
  await client?.close(); await live.close();
}
