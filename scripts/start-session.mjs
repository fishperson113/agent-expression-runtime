import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));

function startGateway(origin, token) {
  const child = spawn(resolve(root, 'src-tauri/target/debug/agent-expression-runtime.exe'), ['--browser-gateway'], {
    cwd: root, windowsHide: true,
    env: { ...process.env, AER_PAIRING_TOKEN: token, AER_ALLOWED_ORIGINS: origin },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const ready = new Promise((accept, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(Error('Gateway startup timed out.')), 15000);
    const fail = () => { clearTimeout(timer); reject(Error('Gateway could not start.')); };
    child.once('error', fail);
    child.once('exit', fail);
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 4096) return fail();
      if (!buffer.includes('\n')) return;
      clearTimeout(timer);
      try {
        const { baseUrl } = JSON.parse(buffer.split('\n')[0]);
        const address = new URL(baseUrl);
        if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port)
          throw Error();
        accept(baseUrl);
      } catch { fail(); }
    });
  });
  return { child, ready };
}

async function openBody(origin, base, token, headless) {
  let browser;
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      browser = await chromium.launch({ headless, ...(channel ? { channel } : {}) });
      break;
    } catch { /* Try the next installed browser. */ }
  }
  if (!browser) throw Error('Install Microsoft Edge or Google Chrome, then run npm start again.');
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(origin);
    await page.locator('#browser-base').fill(base);
    await page.locator('#browser-token').fill(token);
    await page.locator('#browser-connect').click();
    await page.waitForFunction(() => document.querySelector('#gateway-status')?.textContent.includes('Listening'));
    return { browser, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Child shutdown timed out.')), 10000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  } else child.kill('SIGTERM');
  await exited;
}

function codexHost({ base, token, signal }) {
  return new Promise((accept, reject) => {
    const child = spawn('pwsh', ['-NoProfile', '-File', resolve(root, 'scripts/start-browser.ps1'), '-Agent'], {
      cwd: root, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, AER_BASE_URL: base, AER_PAIRING_TOKEN: token },
    });
    const stop = () => void stopChild(child).catch(reject);
    signal.addEventListener('abort', stop, { once: true });
    child.once('error', () => { signal.removeEventListener('abort', stop); reject(Error('Codex could not start.')); });
    child.once('exit', code => { signal.removeEventListener('abort', stop); accept(code ?? 1); });
    if (signal.aborted) stop();
  });
}

export async function runSession({ headless = false, runHost = codexHost } = {}) {
  const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  const abort = new AbortController();
  let gateway, body;
  let interrupt;
  const interrupted = new Promise(resolve => { interrupt = () => { abort.abort(); resolve(130); }; });
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const token = randomBytes(32).toString('hex');
    gateway = startGateway(origin, token);
    const base = await gateway.ready;
    body = await openBody(origin, base, token, headless);
    const disconnected = new Promise(resolve => {
      body.browser.once('disconnected', () => resolve(0));
      body.page.once('close', () => resolve(0));
      gateway.child.once('exit', () => resolve(1));
    });
    console.log('Expression engine paired. Starting Codex in this pane; exit Codex or close the body to stop.');
    return await Promise.race([
      runHost({ base, token, origin, page: body.page, gateway: gateway.child, signal: abort.signal }),
      disconnected, interrupted,
    ]);
  } finally {
    abort.abort();
    const cleanup = await Promise.allSettled([
      body?.browser.close(), stopChild(gateway?.child), vite.close(),
    ]);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    const failed = cleanup.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSession().then(code => { process.exitCode = code; }).catch(() => {
    console.error('Session failed. Check Edge/Chrome, Codex login, and the gateway build; then run npm start again.');
    process.exitCode = 1;
  });
}
