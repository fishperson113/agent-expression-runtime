import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { startGateway, stopChild } from '../scripts/start-session.mjs';
import { prepareLiveAssets } from '../scripts/prepare-live-assets.mjs';

export const liveRoot = fileURLToPath(new URL('../', import.meta.url));
export async function openLive({ headless = false, signal } = {}) {
  await prepareLiveAssets(resolve(liveRoot, 'public/live-assets'));
  const vite = await createServer({ root: liveRoot, server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
  const origin = vite.resolvedUrls.local[0].replace(/\/$/, ''), token = randomBytes(32).toString('hex');
  let gateway, browser;
  try {
    gateway = startGateway(origin, token); const base = await gateway.ready;
    browser = await chromium.launch({ headless, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      ...(headless ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}) });
    const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    await page.goto(origin + '/live.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!window.fischLive);
    await page.evaluate(({ base, token }) => window.fischLive.pair(base, token), { base, token });
    await page.waitForFunction(() => document.getElementById('connection').textContent.includes('Đã nối'));
    page.on('domcontentloaded', () => { void pairReload(page, base, token); });
    const close = async () => { await browser?.close(); await stopChild(gateway.child); await vite.close(); };
    signal?.addEventListener('abort', () => { void close(); }, { once: true });
    return { page, browser, base, token, close, gateway: gateway.child };
  } catch (error) { await browser?.close(); if (gateway) await stopChild(gateway.child); await vite.close(); throw error; }
}
async function pairReload(page, base, token) {
  try {
    await page.waitForFunction(() => !!window.fischLive);
    await page.evaluate(({ base, token }) => window.fischLive.pair(base, token), { base, token });
  } catch { if (!page.isClosed()) console.error('Live browser re-pair failed; restart fisch live.'); }
}
export async function createLivePane(call, source, base, token) {
  const created = await call('tab.create', { workspace_id: source.workspace_id, cwd: liveRoot,
    label: 'Fisch Live', focus: true, env: { AER_BASE_URL: base, AER_PAIRING_TOKEN: token, FISCH_LIVE: '1',
      FISCH_PLANNER_BACKEND: 'off' } });
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
