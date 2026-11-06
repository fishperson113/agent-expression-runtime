import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { runSession } from './start-session.mjs';

const evidence = { target: { rise: 1, advance: 1, grow: 2, spread: 2 }, viewports: [], pageErrors: [] };
await runSession({ headless: true, runHost: async ({ base, token, page }) => {
  const api = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    const result = await response.json();
    if (!response.ok) throw Error(result.code ?? 'framing_gateway_error');
    return result;
  };
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  const session = await api('/v1/sessions', {});
  const admitted = await api(`/v1/sessions/${session.id}/expressions`, {
    epoch: session.epoch, requestId: 'framing-posture', kind: 'state',
    body: { ...evidence.target, durationMs: 0 },
  });
  if (admitted.status !== 'accepted') throw Error('posture_admission_unconfirmed');
  mkdirSync('docs/evidence', { recursive: true });
  for (const [name, width, height] of [['desktop', 1280, 900], ['portrait', 375, 812]]) {
    await page.setViewportSize({ width, height });
    await delay(500);
    await page.locator('#body').screenshot({ path: `docs/evidence/framing-${name}.png` });
    evidence.viewports.push({ name, width, height, admission: admitted.status });
  }
  if (evidence.pageErrors.length) throw Error('framing_page_error');
  writeFileSync('docs/evidence/framing-smoke.json', JSON.stringify(evidence, null, 2));
  return 0;
} });
console.log(JSON.stringify(evidence, null, 2));
