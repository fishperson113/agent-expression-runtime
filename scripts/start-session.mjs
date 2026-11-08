import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

export const gatewayExecutable = (platform = process.platform, available = existsSync) => {
  const suffix = platform === 'win32' ? '.exe' : '';
  const standalone = resolve(root, 'src-tauri/target/debug/fisch-gateway' + suffix);
  return available(standalone) ? standalone : resolve(root, 'src-tauri/target/debug/agent-expression-runtime' + suffix);
};

export function codexArguments() {
  return ['--no-daemon', '--no-alt-screen', '-C', root,
    '-c', 'mcp_servers.aer.command="node"',
    '-c', 'mcp_servers.aer.args=' + JSON.stringify([resolve(root, 'integrations/mcp-server.mjs').replaceAll('\\', '/')]),
    '-c', 'mcp_servers.aer.env_vars=["AER_BASE_URL","AER_PAIRING_TOKEN"]',
    '-c', 'mcp_servers.aer.required=true',
    'Read aer://instructions/v1 from aer. Use express for short expressions alongside normal replies. Start with a brief sphere expression. Keep credentials out of messages.'];
}

export async function codexCommand() {
  if (process.platform !== 'win32') return { command: 'codex', args: [] };
  const { stdout } = await promisify(execFile)('where.exe', ['codex'], { windowsHide: true });
  for (const candidate of stdout.trim().split(/\r?\n/)) {
    if (candidate.endsWith('.exe')) return { command: candidate, args: [] };
    const script = resolve(dirname(candidate), 'node_modules/@openai/codex/bin/codex.js');
    if (existsSync(script)) return { command: process.execPath, args: [script] };
  }
  throw Error('Install Codex CLI with npm install -g @openai/codex, then run codex login.');
}

export async function inspectEnvironment() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const checks = [{ name: 'Node', ok: major > 22 || (major === 22 && minor >= 12), detail: process.version }];
  for (const name of ['Rust', 'Codex']) {
    try {
      const host = name === 'Rust' ? { command: 'cargo', args: [] } : await codexCommand();
      const { stdout } = await promisify(execFile)(host.command, [...host.args, '--version'], { windowsHide: true });
      checks.push({ name, ok: true, detail: stdout.trim() });
    } catch { checks.push({ name, ok: false, detail: name === 'Rust' ? 'Install Rust and platform Tauri prerequisites.' : 'Install Codex CLI and run codex login.' }); }
  }
  const browsers = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    resolve(process.env['ProgramFiles(x86)'] ?? '/', 'Microsoft/Edge/Application/msedge.exe'),
    resolve(process.env.ProgramFiles ?? '/', 'Google/Chrome/Application/chrome.exe')];
  try {
    const { chromium } = await import('@playwright/test');
    browsers.push(chromium.executablePath());
  } catch { /* fisch run installs missing local npm dependencies. */ }
  const browser = browsers.find(path => path && existsSync(path));
  checks.push({ name: 'Browser', ok: !!browser, detail: browser ?? 'Install Edge/Chrome or set CHROME_PATH.' });
  const installed = existsSync(resolve(root, 'node_modules/vite/package.json'));
  checks.push({ name: 'Dependencies', ok: installed, optional: true,
    detail: installed ? 'Installed' : 'fisch run will install them.' });
  return checks;
}

function runChecked(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', () => reject(Error('Could not start ' + command + '. Check system prerequisites.')));
    child.once('exit', code => code === 0 ? resolve() : reject(Error(command + ' failed. See the output above.')));
  });
}

function npmCommand() {
  const script = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  return existsSync(script) ? { command: process.execPath, args: [script] } : { command: 'npm', args: [] };
}

export async function prepareSession({ withCodex = true } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw Error('Install Node.js 22.12 or newer.');
  if (withCodex) {
    const host = await codexCommand();
    await runChecked(host.command, [...host.args, '--version']);
  }
  await runChecked('cargo', ['--version']);
  const npm = npmCommand();
  if (!existsSync(resolve(root, 'node_modules/vite/package.json')) || !existsSync(resolve(root, 'node_modules/@playwright/test/package.json')))
    await runChecked(npm.command, [...npm.args, 'ci']);
  await runChecked(npm.command, [...npm.args, 'run', 'build']);
  await runChecked('cargo', ['build', '--locked', '--no-default-features', '--bin', 'fisch-gateway', '--manifest-path', 'src-tauri/Cargo.toml']);
}

export async function testSession() {
  await prepareSession({ withCodex: false });
  const npm = npmCommand();
  await runChecked(npm.command, [...npm.args, 'test']);
  await runChecked(npm.command, [...npm.args, 'run', 'check:architecture']);
  await runChecked('cargo', ['test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml']);
}

export function startGateway(origin, token) {
  const child = spawn(gatewayExecutable(), ['--browser-gateway'], {
    cwd: root, windowsHide: true, detached: process.platform !== 'win32',
    env: { ...process.env, AER_PAIRING_TOKEN: token, AER_ALLOWED_ORIGINS: origin },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  child.aerProcessGroup = process.platform !== 'win32';
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
  const { chromium } = await import('@playwright/test');
  let browser;
  for (const channel of process.env.CHROME_PATH ? [undefined] : ['msedge', 'chrome', undefined]) {
    try {
      browser = await chromium.launch({ headless, ...(channel ? { channel } : {}),
        ...(headless ? { args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}),
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
      break;
    } catch { /* Try the next installed browser. */ }
  }
  if (!browser) throw Error('Install Microsoft Edge or Google Chrome, then run fisch run again.');
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await pairRenderer(page, base, token);
    page.on('domcontentloaded', () => { void pairRenderer(page, base, token).catch(() => {}); });
    return { browser, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function pairRenderer(page, base, token) {
  await page.locator('#browser-base').fill(base);
  await page.locator('#browser-token').fill(token);
  await page.locator('#browser-connect').click();
  await page.waitForFunction(() => document.querySelector('#gateway-status')?.textContent.includes('Listening'));
  await page.waitForFunction(() => /worker|fallback/.test(document.querySelector('#mode')?.textContent ?? ''));
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
  } else if (child.aerProcessGroup) process.kill(-child.pid, 'SIGTERM');
  else child.kill('SIGTERM');
  await exited;
}

async function codexHost({ base, token, signal }) {
  const host = await codexCommand();
  return new Promise((accept, reject) => {
    const child = spawn(host.command, [...host.args, ...codexArguments()], {
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
  const { createServer } = await import('vite');
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
    console.log('Fisch engine paired. Starting Codex in this pane; exit Codex or close the body to stop.');
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
  prepareSession().then(() => runSession()).then(code => { process.exitCode = code; }).catch(error => {
    console.error('Session failed: ' + (error.message.startsWith('Install ') || error.message.includes('failed.') || error.message.startsWith('Could not start ') ? error.message : 'Check Edge/Chrome, Codex login and the gateway build, then run fisch run again.'));
    process.exitCode = 1;
  });
}
