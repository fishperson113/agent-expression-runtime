import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { peaceParts, birdParts, sculptureProgram } from '../integrations/sculpture-examples.mjs';

const vite = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], results = [];
try {
  mkdirSync('docs/evidence', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
  await page.waitForFunction(() => document.querySelector('#mode')?.textContent.match(/worker|fallback/));
  const cases = [['peace', sculptureProgram(peaceParts())], ['bird', sculptureProgram(birdParts())]];
  if (process.env.FISCH_SCULPTURE_EVIDENCE) {
    const generated = JSON.parse(readFileSync(process.env.FISCH_SCULPTURE_EVIDENCE, 'utf8'));
    cases.push(['generated', generated.body]);
  }
  for (const [name, body] of cases) {
    await page.getByLabel('Program body', { exact: true }).fill(JSON.stringify(body));
    await page.getByRole('button', { name: 'Apply program', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#shape')?.textContent.includes('assembled'));
    await page.waitForTimeout(1600);
    const feedback = await page.locator('#feedback').textContent();
    if (/diagnostic|reject|error/i.test(feedback)) throw Error(feedback);
    await page.locator('canvas').screenshot({ path: `docs/evidence/composition-${name}.png` });
    results.push({ name, feedback });
  }
  writeFileSync('docs/evidence/composition-smoke.json', JSON.stringify({ results, errors, humanRecognition: 'not-assessed' }, null, 2));
  if (errors.length) throw Error(errors.join('; '));
} finally { await browser.close(); await vite.close(); }
