import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { runLiveSession } from '../scripts/live-session.mjs';
import { runTerminalCodex } from '../integrations/live-terminal.mjs';
import { openLive } from '../integrations/live-launch.mjs';
import { gatewayExecutable } from '../scripts/start-session.mjs';

const fixture = fileURLToPath(new URL('./fixtures/playground-agent.mjs', import.meta.url));
const required = process.env.FISCH_PLAYGROUND_REQUIRE_GATEWAY === '1';
const scene = { parts: [{ id: 'restart-public-synthetic', kind: 'ellipsoid', center: [0, 0, 0], scale: [.2, .3, .1] }],
  style: { color: '#1277aa', brightness: .8, pointSize: 1.2, dispersion: .1 }, flow: { field: 'pulse', strength: .1 } };

function inbox(child) {
  let buffer = ''; const queue = [], waiters = [];
  child.stdout.on('data', bytes => {
    buffer += bytes;
    if (buffer.length > 1048576) throw Error('restart_fixture_output_limit');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (waiters.length) waiters.shift()(value);
      else { if (queue.length >= 32) throw Error('restart_fixture_queue_limit'); queue.push(value); }
    }
  });
  return async () => {
    if (queue.length) return queue.shift();
    let timer, callback;
    try { return await new Promise((resolve, reject) => {
      callback = resolve; waiters.push(callback); timer = setTimeout(() => reject(Error('restart_fixture_timeout')), 15000);
    }); } finally { clearTimeout(timer); const index = waiters.indexOf(callback); if (index >= 0) waiters.splice(index, 1); }
  };
}

async function launch() {
  const abort = new AbortController(), record = {};
  let ready;
  const spawned = new Promise(resolve => { ready = resolve; });
  const running = runLiveSession({ assets: false, headless: true, signal: abort.signal,
    open: options => openLive({ ...options, production: false, synthetic: true, inspect: async page => {
      await page.addInitScript("window.restartMediaCalls = 0; navigator.mediaDevices.getUserMedia = async () => { window.restartMediaCalls++; throw Error('synthetic_media_forbidden'); };");
    } }), runHost: options => {
      record.live = options.live;
      return runTerminalCodex({ ...options, reactiveProvider: null,
        host: { command: process.execPath, args: [fixture, '--omit-started'] }, spawnClient: (command, args, settings) => {
          record.remote = args[args.indexOf('--remote') + 1]; record.auth = settings.env.FISCH_CODEX_TRANSPORT_TOKEN;
          expect(args.includes(record.auth)).toBe(false); expect(settings.windowsHide).toBe(true);
          record.child = spawn(command, args, { ...settings, stdio: ['pipe', 'pipe', 'pipe'] });
          record.child.stderr.resume(); record.next = inbox(record.child); ready(); return record.child;
        } });
    } });
  void running.catch(() => {});
  record.close = async () => { abort.abort(); record.child?.stdin.end(); await running.catch(() => {}); };
  record.abort = () => abort.abort(); record.running = running;
  try {
    let timer;
    try { await Promise.race([spawned, running.then(() => { throw Error('restart_launch_early_exit'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('restart_launch_timeout')), 60000); })]); }
    finally { clearTimeout(timer); }
    expect((await record.next()).type).toBe('ready');
    await expect.poll(() => record.live.page.locator('.setup-native').textContent()).toContain('đã chọn phiên');
    await expect.poll(() => record.live.page.locator('.setup-observer').textContent()).toContain('tắt trong cấu hình');
    record.url = record.live.page.url();
    record.send = command => record.child.stdin.write(JSON.stringify(command) + '\n');
    record.call = async command => { record.send(command); const reply = await record.next(); expect(reply.type).toBe('result'); return reply.value; };
    return record;
  } catch (error) { await record.close(); throw error; }
}

async function noMedia(route) {
  expect(await route.live.page.evaluate(() => ({ calls: window.restartMediaCalls,
    active: window.fischLive.metrics().cameraActive, videos: [...document.querySelectorAll('video')].some(video => !!video.srcObject) })))
    .toEqual({ calls: 0, active: false, videos: false });
}

async function pendingCreation(route) {
  const page = route.live.page, panel = page.locator('.fisch-playground');
  await panel.locator('summary').click();
  await panel.getByLabel('Ý tưởng', { exact: true }).fill('Bản nháp tổng hợp chỉ của phiên cũ');
  await panel.getByLabel('Mục tiêu tùy chọn', { exact: true }).fill('Không tự lưu qua lần khởi chạy');
  await page.locator('#motion').selectOption('off');
  route.send({ operation: 'create', scene });
  await expect.poll(() => page.evaluate(() => window.fischLive.metrics().schedulerBusy)).toBe(true);
  await expect.poll(() => panel.locator('.pg-status').textContent()).toContain('đang xử lý');
  await noMedia(route);
}

async function closed(route) {
  await expect.poll(() => route.child.exitCode !== null || route.child.signalCode !== null).toBe(true);
  await expect.poll(() => route.live.gateway.exitCode !== null || route.live.gateway.signalCode !== null).toBe(true);
  expect(route.live.page.isClosed()).toBe(true); expect(route.live.browser.isConnected()).toBe(false);
  await expect(fetch(route.url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
  await expect(fetch(route.live.base + '/v1/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + route.live.token },
    signal: AbortSignal.timeout(1000) })).rejects.toThrow();
  const socket = new WebSocket(route.remote, { headers: { Authorization: 'Bearer ' + route.auth } });
  try { await expect(once(socket, 'open')).rejects.toThrow(); } finally { socket.terminate(); }
}

async function fresh(route, old) {
  expect(route.live.token === old.live.token).toBe(false); expect(route.auth === old.auth).toBe(false);
  const response = await fetch(route.live.base + '/v1/sessions', { method: 'POST',
    headers: { Authorization: 'Bearer ' + old.live.token }, signal: AbortSignal.timeout(2000) });
  expect(response.status).toBe(401);
  const denied = new WebSocket(route.remote, { headers: { Authorization: 'Bearer ' + old.auth } });
  try { await expect(once(denied, 'open')).rejects.toThrow('403'); } finally { denied.terminate(); }
  const panel = route.live.page.locator('.fisch-playground');
  expect(await panel.getByLabel('Ý tưởng', { exact: true }).inputValue()).toBe('');
  expect(await panel.getByLabel('Mục tiêu tùy chọn', { exact: true }).inputValue()).toBe('');
  expect(await panel.getByLabel('Yêu cầu chưa gửi tới Codex').inputValue()).toBe('');
  expect(await route.call({ operation: 'state', includeScene: true })).toMatchObject({ revision: 0, scenes: 0, pending: null, recoveryRequired: false });
  expect(await route.live.page.evaluate(() => window.fischLive.metrics().parts)).not.toContain(scene.parts[0].id);
  expect(await route.live.page.evaluate(() => window.fischLive.metrics().queueDepth)).toBe(0); await noMedia(route);
  expect(await route.call({ operation: 'create', scene })).toMatchObject({ status: 'committed', revision: 1 });
}

for (const mode of ['ui', 'page-close', 'abort']) {
  it.skipIf(!required && !existsSync(gatewayExecutable()))(`restarts privately after ${mode} stops a pending creation through the real terminal route`, async () => {
    expect(existsSync(gatewayExecutable())).toBe(true);
    let first, second;
    try {
      first = await launch(); await pendingCreation(first);
      if (mode === 'ui') await first.live.page.locator('#stop-all').click();
      else if (mode === 'page-close') await first.live.page.close();
      else first.abort();
      const stopExitCode = await first.running; await closed(first);
      console.log(JSON.stringify({ restartRoute: mode, intentionalStopExitCode: stopExitCode }));
      second = await launch(); await fresh(second, first);
    } finally { await second?.close(); await first?.close(); }
    if (second) await closed(second);
  }, 120000);
}
