import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer, preview } from 'vite';
import { chromium } from '@playwright/test';
import { startGateway, stopChild } from '../scripts/start-session.mjs';
import { prepareLiveRuntime } from '../scripts/prepare-live.mjs';

export const liveRoot = fileURLToPath(new URL('../', import.meta.url));
export function livePageOptions(headless = false) {
  return { viewport: headless ? { width: 1360, height: 950 } : null };
}
export async function closeLiveResources(actions) {
  const results = await Promise.allSettled(actions.map(action => Promise.resolve().then(action)));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}
export async function openLive({ hands, assets, headless = false, signal, inspect = () => {}, production = true, synthetic = false } = {}) {
  if (signal?.aborted) throw Error('live_start_cancelled');
  await prepareLiveRuntime({ hands, assets, production, signal });
  if (signal?.aborted) throw Error('live_start_cancelled');
  const vite = production ? await preview({ root: liveRoot, preview: { host: '127.0.0.1', port: 0 } }) :
    await createServer({ root: liveRoot, server: { host: '127.0.0.1', port: 0 } });
  if (!production) await vite.listen();
  const closeServer = () => vite.close();
  const origin = vite.resolvedUrls.local[0].replace(/\/$/, ''), token = randomBytes(32).toString('hex');
  let gateway, browser;
  try {
    gateway = startGateway(origin, token); const base = await gateway.ready;
    if (signal?.aborted) throw Error('live_start_cancelled');
    browser = await launchLiveBrowser(headless);
    const page = await browser.newPage(livePageOptions(headless));
    inspect(page);
    const query = new URLSearchParams();
    if (process.env.FISCH_VISION_DELEGATE === 'CPU') query.set('vision', 'cpu');
    if (synthetic) query.set('fixture', 'synthetic');
    await page.goto(origin + '/live.html?' + query, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!window.fischLive);
    await page.evaluate(({ base, token }) => window.fischLive.pair(base, token), { base, token });
    await page.waitForFunction(() => document.getElementById('connection').textContent.includes('Đã nối'));
    page.on('domcontentloaded', () => { void pairReload(page, base, token); });
    let closing;
    const close = () => closing ??= closeLiveResources([() => browser?.close(), () => stopChild(gateway.child), closeServer])
      .finally(() => signal?.removeEventListener('abort', onAbort));
    const onAbort = () => { void close().catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { await close(); throw Error('live_start_cancelled'); }
    return { page, browser, base, token, close, gateway: gateway.child };
  } catch (error) {
    await closeLiveResources([() => browser?.close(), () => stopChild(gateway?.child), closeServer]).catch(() => {});
    throw error;
  }
}
async function pairReload(page, base, token) {
  try {
    await page.waitForFunction(() => !!window.fischLive);
    await page.evaluate(({ base, token }) => window.fischLive.pair(base, token), { base, token });
  } catch { if (!page.isClosed()) console.error('Live browser re-pair failed; restart fisch live.'); }
}
export async function createLivePane(call, source, base, token) {
  const workspace = source.cwd ?? liveRoot;
  const created = await call('tab.create', { workspace_id: source.workspace_id, cwd: workspace,
    label: 'Fisch Live', focus: true, env: { AER_BASE_URL: base, AER_PAIRING_TOKEN: token, FISCH_LIVE: '1',
      FISCH_PLANNER_BACKEND: 'off', FISCH_LIVE_WORKSPACE: workspace } });
  const { snapshot } = await call('session.snapshot');
  const pane = snapshot.panes.find(pane => pane.tab_id === created.tab.tab_id);
  if (!pane) throw Error('Live pane was not created.');
  const path = resolve(liveRoot, 'scripts/live-codex.mjs');
  const command = process.platform === 'win32'
    ? `& '${process.execPath.replaceAll("'", "''")}' '${path.replaceAll("'", "''")}'`
    : `'${process.execPath.replaceAll("'", "'\\''")}' '${path.replaceAll("'", "'\\''")}'`;
  await call('pane.send_input', { pane_id: pane.pane_id, text: command, keys: ['enter'] });
  return pane;
}

async function launchLiveBrowser(headless) {
  const options = { headless, ...(headless ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}) };
  const system = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(existsSync);
  const candidates = process.env.CHROME_PATH ? [{ executablePath: process.env.CHROME_PATH }] :
    [{ channel: 'msedge' }, { channel: 'chrome' }, ...system.map(executablePath => ({ executablePath })), {}];
  for (const candidate of candidates) {
    try { return await chromium.launch({ ...options, ...candidate }); } catch { /* Try an installed browser; never install one implicitly. */ }
  }
  throw Error('No supported browser could start. Install Edge/Chrome or run npx playwright install chromium, or check CHROME_PATH; then retry fisch live.');
}
