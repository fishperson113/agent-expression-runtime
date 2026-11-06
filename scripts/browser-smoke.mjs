import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.AER_BROWSER_URL ?? 'http://127.0.0.1:5173');
await page.waitForFunction(
  () => !document.querySelector('#mode').textContent.includes('Initializing'),
  { timeout: 15000 },
);
await page.getByRole('button', { name: 'Start turn' }).click();
await page.waitForFunction(() => document.querySelector('.answer')?.textContent.length > 70);
await page.getByRole('button', { name: 'Cancel turn' }).click();
const text = await page.locator('.answer').textContent();
await page.waitForTimeout(150);
if (text !== (await page.locator('.answer').textContent()))
  throw Error('Content changed after cancel');
await page.getByLabel('Program body').fill('{"type":"eval","code":"bad"}');
await page.getByRole('button', { name: 'Apply program' }).click();
await page.waitForFunction(() =>
  document.querySelector('#feedback').textContent.includes('diagnostic'),
);
await page.getByLabel('Program body').fill('{"type":"morph","target":"wall","durationMs":700}');
await page.getByRole('button', { name: 'Apply program' }).click();
await page.waitForFunction(() => document.querySelector('#shape').textContent.includes('wall'));
await page.waitForTimeout(800);
mkdirSync('docs/evidence', { recursive: true });
await page.screenshot({ path: 'docs/evidence/browser-desktop.png', fullPage: true });
const desktop = await page.evaluate(() => ({
  mode: document.querySelector('#mode').textContent,
  counts: document.querySelector('#counts').textContent,
  frame: document.querySelector('#frame').textContent,
  overflow: document.documentElement.scrollWidth > innerWidth,
  webgl: !!document.querySelector('canvas'),
}));
await page.setViewportSize({ width: 375, height: 812 });
await page.screenshot({ path: 'docs/evidence/browser-mobile.png', fullPage: true });
const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
await page.getByLabel('Reduced motion', { exact: true }).check();
await page.getByLabel('Telemetry', { exact: true }).uncheck();
if (await page.locator('#telemetry').isVisible()) throw Error('Telemetry toggle failed');
await page.close();
const fallback = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await fallback.addInitScript(() => {
  Object.defineProperty(window, 'OffscreenCanvas', { value: undefined });
});
await fallback.goto(process.env.AER_BROWSER_URL ?? 'http://127.0.0.1:5173');
await fallback.waitForFunction(() =>
  document.querySelector('#mode').textContent.includes('fallback'),
);
const fallbackMode = await fallback.locator('#mode').textContent();
await fallback.close();
const result = {
  desktop,
  mobileOverflow,
  fallbackMode,
  pageErrors: errors,
  note: 'Chromium headless SwiftShader smoke test; not native WebView/GPU performance acceptance.',
};
writeFileSync('docs/evidence/browser-smoke.json', JSON.stringify(result, null, 2));
await browser.close();
if (errors.length || desktop.overflow || mobileOverflow) throw Error(JSON.stringify(result));
console.log(JSON.stringify(result, null, 2));
