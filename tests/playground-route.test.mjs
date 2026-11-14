import { externalPlayground, fixtureNativeCall } from './fixtures/playground-external.mjs';
import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dispatch } from '../bin/fisch.mjs';
import { runLiveSession } from '../scripts/live-session.mjs';
import { runTerminalCodex } from '../integrations/live-terminal.mjs';
import { gatewayExecutable } from '../scripts/start-session.mjs';
import { openLive } from '../integrations/live-launch.mjs';

const fixture = fileURLToPath(new URL('./fixtures/playground-agent.mjs', import.meta.url));
const required = process.env.FISCH_PLAYGROUND_REQUIRE_GATEWAY === '1';
const soakMs = Number(process.env.FISCH_PLAYGROUND_ROUTE_SOAK_MS ?? 0);
if (!Number.isSafeInteger(soakMs) || soakMs < 0 || soakMs > 1200000) throw Error('route_soak_duration');
const scene = id => ({ parts: [{ id, kind: 'ellipsoid', center: [0, 0, 0], scale: [0.2, 0.3, 0.1] }],
  style: { color: '#1277aa', brightness: 0.8, pointSize: 1.2, dispersion: 0.1 }, flow: { field: 'pulse', strength: 0.1 } });

function messages(child) {
  const queue = [], waiting = []; let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk; let end;
    if (Buffer.byteLength(buffer) > 1048576) throw Error('scripted_native_output_limit');
    while ((end = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (waiting.length) waiting.shift().resolve(message); else {
        if (queue.length >= 64) throw Error('scripted_native_queue_limit'); queue.push(message);
      }
    }
  });
  return () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
    if (waiting.length >= 16) { reject(Error('scripted_native_waiter_limit')); return; }
    const entry = { resolve: value => { clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { const index = waiting.indexOf(entry); if (index >= 0) waiting.splice(index, 1); reject(Error('scripted_native_timeout')); }, 20000);
    waiting.push(entry);
  });
}

async function soak(call, page) {
  const started = performance.now(); let turns = 0;
  const stillMs = soakMs >= 120000 ? 120000 : 0;
  if (stillMs) {
    const before = await call({ operation: 'state', includeScene: true });
    const parts = await page.evaluate(() => window.fischLive.metrics().parts);
    for (let elapsed = 0; elapsed < stillMs; elapsed += 10000) {
      await page.waitForTimeout(10000);
      const metrics = await page.evaluate(() => window.fischLive.metrics());
      expect(metrics.parts).toEqual(parts); expect(metrics.queueDepth).toBe(0); expect(metrics.cameraActive).toBe(false);
    }
    expect(await call({ operation: 'state', includeScene: true })).toEqual(before);
    expect(await page.evaluate(() => window.fischLive.metrics().parts)).toEqual(parts);
    expect((await page.evaluate(() => window.fischLive.metrics())).queueDepth).toBe(0);
  }
  while (performance.now() - started < soakMs) {
    const before = await call({ operation: 'state' });
    const result = await call({ operation: 'remix', scene: scene('soak-' + turns % 3) });
    expect(result).toMatchObject({ status: 'committed', revision: before.revision + 1, pending: null });
    expect(await page.evaluate(() => window.fischLive.metrics().parts)).toEqual(['soak-' + turns % 3]);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull(); turns++;
  }
  if (soakMs) {
    expect(await call({ operation: 'state' })).toMatchObject({ pending: null, recoveryRequired: false, closed: false });
    console.log(JSON.stringify({ scriptedRouteSoak: true, elapsedMs: Math.round(performance.now() - started), stillMs, turns, errors: 0, camera: 'off', modelCalls: 0 }));
  }
}

async function holdReaction(page, requests) {
  await page.locator('.camera-options summary').click();
  await page.locator('#enable-reactivity').check();
  await page.keyboard.press('Escape');
  expect(await page.locator('.camera-options dialog[open]').count()).toBe(0);
  for (const wait of [1100, 800, 0]) {
    await page.evaluate(() => window.fischLive.fixture('present'));
    if (wait) await page.waitForTimeout(wait);
  }
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  const refresh = setInterval(() => { void page.evaluate(() => window.fischLive.fixture('present')).catch(() => {}); }, 200);
  return () => clearInterval(refresh);
}

async function copyRequest(page, operation) {
  const panel = page.locator('.fisch-playground');
  if (await panel.locator('details').getAttribute('open') === null) await panel.locator('summary').click();
  if (['create', 'remix'].includes(operation)) {
    await panel.getByLabel('Ý tưởng', { exact: true }).fill('Ý tưởng tổng hợp của route test');
    await panel.getByLabel('Mục tiêu tùy chọn', { exact: true }).fill('Thử hình học tự do');
  }
  const label = { create: 'Nguyên tác', remix: 'Chỉnh ý tưởng', undo: 'Hoàn tác', reset: 'Về bản đầu', recover: 'Phục hồi' }[operation];
  await panel.getByRole('button', { name: label, exact: true }).click();
  const text = await page.evaluate(() => window.routeCopied);
  expect(text).toContain('playground_edit'); expect(text).toContain(operation); return text;
}

async function threadSelection(route) {
  const { page } = route.live, panel = page.locator('.fisch-playground');
  await copyRequest(page, 'remix');
  const before = await panel.locator('.pg-status').textContent();
  expect(await route.call({ operation: 'failedSelect' })).toEqual({ selected: false });
  expect(await panel.getByLabel('Ý tưởng', { exact: true }).inputValue()).toBe('Ý tưởng tổng hợp của route test');
  expect(await panel.locator('.pg-status').textContent()).toBe(before);
  const externalBefore = await route.call({ operation: 'state', includeScene: true });
  expect(await route.call({ operation: 'selectThread' })).toEqual({ selected: true });
  expect(await route.call({ operation: 'state', includeScene: true })).toEqual({ ...externalBefore, recoveryRequired: true });
  expect(await panel.getByLabel('Ý tưởng', { exact: true }).inputValue()).toBe('');
  expect(await panel.getByLabel('Mục tiêu tùy chọn', { exact: true }).inputValue()).toBe('');
  expect(await panel.getByLabel('Yêu cầu chưa gửi tới Codex').inputValue()).toBe('');
}

async function launch(provider) {
  let live, child, next, external, stderr = '', resolveSpawn;
  const spawned = new Promise(resolve => { resolveSpawn = resolve; });
  const abort = new AbortController();
  const running = dispatch(['live', '--no-assets'], { live: options => runLiveSession({ ...options, headless: true, signal: abort.signal,
      open: settings => openLive({ ...settings, synthetic: true }),
      runHost: args => { live = args.live; return runTerminalCodex({ ...args, reactiveProvider: provider,
        host: { command: process.execPath, args: [fixture, '--omit-started'] }, spawnClient: (command, argv, settings) => {
          child = spawn(command, argv, { ...settings, stdio: ['pipe', 'pipe', 'pipe'] }); next = messages(child); resolveSpawn();
          child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); }); return child;
        } }); } }) });
  void running.catch(() => {});
  try {
    let timer;
    try { await Promise.race([spawned, running.then(() => { throw Error('scripted_native_exited_before_start'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('scripted_native_launch_timeout')), 60000); })]); }
    finally { clearTimeout(timer); }
    const ready = await next(); expect(ready).toMatchObject({ type: 'ready', lane: 'native-fixture' });
    const nativeCall = fixtureNativeCall(child, next);
    external = await externalPlayground(live.base, live.token, nativeCall, abort.signal);
    expect(external.tools).toContain('playground_edit'); expect(external.tools).toContain('playground_state');
    void running.finally(() => external.close()).catch(() => {});
    await live.page.evaluate(() => { window.routeCopied = ''; Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async text => { window.routeCopied = text; } } });
      window.routeDeliveries = []; const deliver = window.fischLive.deliverReactiveDecision;
      window.fischLive.deliverReactiveDecision = async (id, data) => { const result = await deliver(id, data);
        window.routeDeliveries.push({ id, reason: result?.reason }); window.routeDeliveries.splice(0, Math.max(0, window.routeDeliveries.length - 8)); return result; };
      window.routeBarriers = []; const intent = window.fischLive.reactiveUserIntent;
      window.fischLive.reactiveUserIntent = () => { window.routeBarriers.push({ at: performance.now(), ...window.fischLive.reactiveStatus() });
        window.routeBarriers.splice(0, Math.max(0, window.routeBarriers.length - 8)); return intent(); }; });
    return { live, call: external.call, send: external.send, next: external.next,
      exit: async () => { await external.close(); child.stdin.write('{"operation":"exit"}\n'); return running; },
      close: async () => { abort.abort(); await external?.close(); child?.stdin.end(); await running.catch(() => {}); } };
  } catch (error) { abort.abort(); await external?.close(); child?.stdin.end(); await running.catch(() => {}); throw error; }
}

async function creationLoop(route, candidate, release, firstText) {
  const { call, live: { page } } = route;
  for (const [operation, creation, revision, part] of [['create', scene('a'), 1, 'a'], ['remix', scene('b'), 2, 'b'],
      ['undo', undefined, 3, 'a'], ['remix', scene('c'), 4, 'c'], ['reset', undefined, 5, 'a']]) {
      if (operation === 'undo') expect((await call({ operation: 'express' })).status).toBe('accepted');
      const text = operation === 'create' ? firstText : await copyRequest(page, operation);
      const pending = call({ operation, scene: creation, text });
      if (operation === 'create') {
        const request = candidate.request;
        await expect.poll(() => page.evaluate(() => window.routeBarriers.length)).toBeGreaterThan(0);
        const barrier = await page.evaluate(() => window.routeBarriers[0]);
        expect(barrier.sourceValid).toBe(true); expect(barrier.transport).toBe(request.requestId); expect(barrier.at).toBeLessThan(request.deadline);
        expect(await page.evaluate(() => performance.now())).toBeLessThan(request.deadline);
        release({ schemaVersion: 1, requestId: request.requestId, decisionId: 'scripted-late-decision', mode: 'express', validUntil: request.deadline,
          action: { actionId: 'scripted-late-action', body: { type: 'live', program: { type: 'morph', target: 'pyramid', durationMs: 100 },
            configuration: { controls: [], poses: [], lifetimeMs: 1000 } } } });
        await expect.poll(() => page.evaluate(id => window.routeDeliveries.find(value => value.id === id)?.reason, request.requestId)).toBe('revoked');
        expect((await page.evaluate(() => window.fischLive.reactiveStatus())).owner).toBeNull();
        await page.locator('.camera-options summary').click();
        await page.locator('#enable-reactivity').uncheck();
        await page.keyboard.press('Escape');
        expect(await page.locator('.camera-options dialog[open]').count()).toBe(0);
      }
      expect(await pending).toMatchObject({ status: 'committed', revision });
      await expect.poll(() => page.evaluate(() => window.fischLive.metrics().parts)).toEqual([part]);
  }
  expect((await call({ operation: 'state', includeScene: true })).scene).toEqual(scene('a'));
}

async function recovery(route) {
  const { call, live: { page } } = route;
  await page.locator('#motion').selectOption('off');
  route.send({ operation: 'remix', scene: scene('interrupted') });
  await expect.poll(() => page.evaluate(() => window.fischLive.metrics().schedulerBusy)).toBe(true);
  expect((await call({ operation: 'inspectState' })).pending).not.toBeNull();
  await page.locator('#cancel').click();
  expect((await route.next()).value).toMatchObject({ status: 'uncertain', recoveryRequired: true });
  await page.locator('#motion').selectOption('normal');
  expect(await call({ operation: 'recover', text: await copyRequest(page, 'recover') })).toMatchObject({ status: 'recovered', revision: 0 });
  expect(await call({ operation: 'create', scene: scene('fresh') })).toMatchObject({ status: 'committed', revision: 1 });
}

it.skipIf(!existsSync(gatewayExecutable()) && !required)('routes CLI Live through ACK-only native input and independent MCP, Rust and rendered playground', async () => {
  expect(existsSync(fixture), 'Scripted Native fixture must exist').toBe(true);
  expect(existsSync(gatewayExecutable()), 'Required standalone gateway is missing').toBe(true);
  let release; const requests = [];
  const route = await launch({ decide: candidate => { requests.push(candidate); return new Promise(resolve => { release = resolve; }); } });
  let stopSampling;
  try {
    const firstText = await copyRequest(route.live.page, 'create');
    stopSampling = await holdReaction(route.live.page, requests);
    await creationLoop(route, requests[0], release, firstText);
    stopSampling();
    await recovery(route);
    expect(await route.live.page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    await soak(route.call, route.live.page);
    await threadSelection(route);
    expect(await route.exit()).toBe(0);
  } finally { stopSampling?.(); await route.close(); }
}, 120000 + soakMs);
