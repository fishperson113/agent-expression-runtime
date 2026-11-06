import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const vite = await createServer({
  server: { host: '127.0.0.1', port: 49152 + Math.floor(Math.random() * 8000), strictPort: false },
});
await vite.listen();
const port = vite.httpServer.address().port,
  origin = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString('hex');
const executable =
  process.env.AER_GATEWAY_EXE ?? 'src-tauri/target/debug/agent-expression-runtime.exe';
const gateway = spawn(executable, ['--browser-gateway'], {
  windowsHide: true,
  env: { ...process.env, AER_PAIRING_TOKEN: token, AER_ALLOWED_ORIGINS: origin },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
const errors = [];
const evidence = {};
try {
  const base = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(Error('gateway_start_timeout')), 15000);
    gateway.on('error', reject);
    gateway.stdout.on('data', (chunk) => {
      out += chunk.toString();
      const end = out.indexOf('\n');
      if (end >= 0) {
        clearTimeout(timer);
        resolve(JSON.parse(out.slice(0, end)).baseUrl);
      }
    });
    gateway.on('exit', (code) => {
      if (code) reject(Error('gateway_start_failed'));
    });
  });
  async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
    const r = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    const value = r.status === 204 ? {} : await r.json();
    return { http: r.status, ...value };
  }
  console.log('Gateway ready; starting browser smoke');
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    globalThis.__seedChecks = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message?.type === 'seed' || message?.type === 'init')
        globalThis.__seedChecks.push(message.seed);
      if (message?.type === 'ir' && message.ir?.seed !== undefined)
        globalThis.__seedChecks.push(message.ir.seed);
      return original.call(this, message, ...args);
    };
  });
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/?seed=123');
  await page.waitForFunction(
    () =>
      document.querySelector('#mode').textContent.includes('worker') ||
      document.querySelector('#mode').textContent.includes('fallback'),
  );
  await page.locator('#browser-base').fill(base);
  await page.locator('#browser-token').fill(token);
  await page.locator('#browser-connect').click();
  await page.waitForFunction(() =>
    document.querySelector('#gateway-status').textContent.includes('Listening'),
  );
  let session = await api('/v1/sessions', {});
  if (session.http !== 201) throw Error('session_failed');
  let requestId = 0;
  const express = (body) =>
    api(`/v1/sessions/${session.id}/expressions`, {
      epoch: session.epoch,
      requestId: `smoke-${++requestId}`,
      ...body,
    });
  const quality = await express({
    body: {
      type: 'shapeQuality',
      rise: 0.3,
      advance: -0.2,
      grow: 0.8,
      path: 'arc',
      effort: { time: 0.7, weight: 0.3, flow: 0.4 },
      durationMs: 200,
    },
  });
  if (quality.status !== 'accepted') throw Error('quality_rejected');
  evidence.shapeQuality = quality.status;
  await delay(250);
  const define = {
    kind: 'define',
    body: {
      name: 'smokeMacro',
      revision: 1,
      params: {},
      body: { type: 'morph', target: 'pin', durationMs: 100 },
    },
  };
  const defined = await express(define);
  if (defined.status !== 'accepted') throw Error('definition_failed');
  const call = await express({ body: { type: 'call', name: 'smokeMacro', revision: 1, args: {} } });
  if (call.status !== 'accepted') throw Error('macro_commit_failed');
  evidence.macro = call.status;
  await page.getByLabel('Expressions', { exact: true }).uncheck();
  const disabled = await express({ body: { type: 'wait', durationMs: 10 } });
  if (disabled.code !== 'expressions_disabled') throw Error('disable_failed');
  const rejectedDefinition = {
    kind: 'define',
    body: {
      name: 'rejectedMacro',
      revision: 1,
      params: {},
      body: { type: 'wait', durationMs: 10 },
    },
  };
  if ((await express(rejectedDefinition)).code !== 'expressions_disabled')
    throw Error('definition_should_reject');
  await page.getByLabel('Expressions', { exact: true }).check();
  if ((await express(rejectedDefinition)).status !== 'accepted')
    throw Error('rejected_definition_leaked');
  evidence.rejectedDefinitionCanRetry = true;
  await page.getByRole('button', { name: 'Start turn' }).click();
  await page.getByRole('button', { name: 'Apply program' }).click();
  const retained = await express({ body: { type: 'wait', durationMs: 10 } });
  if (retained.status !== 'accepted') throw Error('external_controller_was_revoked');
  evidence.uiRetainsController = true;
  await page.route('**/v1/renderer/complete', async (route) => {
    await delay(650);
    await route.continue();
  });
  const delayedCommand = {
    epoch: session.epoch,
    requestId: 'delayed-ack',
    body: { type: 'morph', target: 'screw', durationMs: 100 },
  };
  const pending = await api(`/v1/sessions/${session.id}/expressions`, delayedCommand);
  if (pending.status !== 'pending') throw Error('timeout_claimed_definitive_result');
  await delay(500);
  const resolved = await api(`/v1/sessions/${session.id}/expressions`, delayedCommand);
  if (resolved.status !== 'accepted') throw Error('delayed_ack_not_resolved');
  await page.unroute('**/v1/renderer/complete');
  evidence.delayedAck = { initial: pending.status, final: resolved.status };
  if ((await page.locator('#mode').textContent()).includes('worker')) {
    await page.evaluate(() => {
      const original = Worker.prototype.postMessage;
      globalThis.__restoreRendererPost = () => (Worker.prototype.postMessage = original);
      Worker.prototype.postMessage = function (message, ...args) {
        if (message?.type === 'ir') setTimeout(() => original.call(this, message, ...args), 650);
        else original.call(this, message, ...args);
      };
    });
    try {
      const command = {
        epoch: session.epoch,
        requestId: 'late-worker-delivery',
        body: { type: 'morph', target: 'pyramid', durationMs: 100 },
      };
      const pendingDelivery = await api(`/v1/sessions/${session.id}/expressions`, command);
      if (pendingDelivery.status !== 'pending') throw Error('expected_pending_transport');
      await delay(500);
      const finalDelivery = await api(`/v1/sessions/${session.id}/expressions`, command);
      if (finalDelivery.status !== 'rejected' || finalDelivery.code !== 'admission_timeout')
        throw Error('worker_transport_restarted_deadline');
      evidence.delayedWorkerDelivery = {
        initial: pendingDelivery.status,
        final: finalDelivery.status,
        code: finalDelivery.code,
      };
    } finally {
      await page.evaluate(() => globalThis.__restoreRendererPost());
    }
  }
  await delay(1000);
  const feedbackAbort = new AbortController();
  const feedback = await fetch(`${base}/v1/sessions/${session.id}/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: feedbackAbort.signal,
  });
  const reader = feedback.body.getReader();
  await express({ body: { type: 'wait', durationMs: 10000 } });
  const cancelled = await api(`/v1/sessions/${session.id}/cancel`, { epoch: session.epoch });
  session.epoch = cancelled.epoch;
  let feedbackText = '';
  try {
    await Promise.race([
      (async () => {
        while (!feedbackText.includes('"status":"cancelled"')) {
          const { value, done } = await reader.read();
          if (done) throw Error('feedback_closed_early');
          feedbackText += new TextDecoder().decode(value);
          if (feedbackText.length > 65536) throw Error('feedback_budget');
        }
      })(),
      delay(3000).then(() => {
        throw Error('cancel_feedback_timeout');
      }),
    ]);
  } finally {
    feedbackAbort.abort();
    await reader.cancel().catch(() => {});
  }
  evidence.cancelledFeedback = true;
  await api(`/v1/sessions/${session.id}`, undefined, 'DELETE');
  session = await api('/v1/sessions', {});
  const missing = await express({
    body: { type: 'call', name: 'smokeMacro', revision: 1, args: {} },
  });
  if (missing.code !== 'unknown_macro') throw Error('macro_leaked_across_sessions');
  await api(`/v1/sessions/${session.id}`, undefined, 'DELETE');
  evidence.sessionMacroIsolation = true;
  await delay(100);
  const cli = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['integrations/cli.mjs', 'smoke'], {
      windowsHide: true,
      env: { ...process.env, AER_BASE_URL: base, AER_PAIRING_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    child.on('exit', (code) => (code ? reject(Error('cli_smoke_failed:' + err)) : resolve(out)));
  });
  if (cli.includes(token)) throw Error('credential_output');
  evidence.cli = cli.trim().split('\n').map(JSON.parse);
  evidence.pageErrors = errors;
  if (errors.length) throw Error('browser_page_error');
  evidence.seedPropagation = await page.evaluate(() => [...new Set(globalThis.__seedChecks)]);
  if (evidence.seedPropagation.length !== 1 || evidence.seedPropagation[0] !== 123)
    throw Error('seed_not_shared');
  const mcp = spawn(process.execPath, ['integrations/mcp-server.mjs'], {
    windowsHide: true,
    env: { ...process.env, AER_BASE_URL: base, AER_PAIRING_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    let buffer = '',
      id = 0;
    const waiting = new Map();
    mcp.stdout.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        waiting.get(message.id)?.(message);
        waiting.delete(message.id);
      }
    });
    const call = () =>
      new Promise((resolve, reject) => {
        const next = ++id,
          timer = setTimeout(() => reject(Error('mcp_timeout')), 4000);
        waiting.set(next, (message) => {
          clearTimeout(timer);
          resolve(message.result);
        });
        mcp.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: next,
            method: 'tools/call',
            params: { name: 'express', arguments: { body: { type: 'wait', durationMs: 20 } } },
          }) + '\n',
        );
      });
    const first = await call(),
      receipt = JSON.parse(first.content[0].text);
    if (receipt.status !== 'accepted') throw Error('mcp_first_admission');
    await api(`/v1/sessions/${receipt.session}`, undefined, 'DELETE');
    const stale = await call();
    if (!stale.isError) throw Error('mcp_stale_session_should_reject');
    const recovered = await call(),
      fresh = JSON.parse(recovered.content[0].text);
    if (fresh.status !== 'accepted') throw Error('mcp_session_not_recovered');
    await api(`/v1/sessions/${fresh.session}`, undefined, 'DELETE');
    evidence.mcpRecoversAfterRevoke = true;
  } finally {
    mcp.kill();
  }
  if (errors.length) throw Error('browser_page_error');
  mkdirSync('docs/evidence', { recursive: true });
  await browser.close();browser=undefined;
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/browser-smoke.mjs'],{windowsHide:true,env:{...process.env,AER_BROWSER_URL:origin},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);child.on('exit',code=>code?reject(Error('basic_browser_smoke_failed:'+output)):resolve());child.on('error',reject);});
  evidence.basicBrowserSmoke=true;
  writeFileSync('docs/evidence/browser-bridge-smoke.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  gateway.kill();
  await vite.close();
}
