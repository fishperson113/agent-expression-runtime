import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

async function probe(page) {
  await page.evaluate(`(async () => {
    const { ThreeRenderer } = await import('/src/adapters/three-renderer.ts');
    const apply = ThreeRenderer.prototype.apply;
    window.localProbe = { captures: {}, x: 0, frame: 0 };
    ThreeRenderer.prototype.apply = function(state, now) {
      const p = window.localProbe, profile = p.pending;
      const shown = profile === 'prior-style' ? { ...state, brightness: 0.65, pointSize: 2, dispersion: 0.12 } : state;
      apply.call(this, shown, now);
      p.x = state.liveMatrices?.[0]?.[3] ?? 0;
      const index = state.particleParts?.findIndex(part => part.id === 'pupil_left') ?? -1;
      p.pupilX = index < 0 ? 0 : state.liveMatrices?.[index + 1]?.[3] ?? 0;
      p.pupilMax = Math.max(p.pupilMax ?? 0, Math.abs(p.pupilX)); p.frame = this.renderSnapshot.frame;
      p.style = { brightness: state.brightness, pointSize: state.pointSize, dispersion: state.dispersion };
      if (!profile) return;
      const gl = this.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const pixels = new Uint8Array(w * h * 4), corner = new Uint8Array(4);
      gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,corner);
      gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let excess = 0, lit = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const value = [0,1,2].reduce((sum, c) => sum + Math.max(0, pixels[i+c]-corner[c]), 0);
        excess += value; if (value > 15) lit++;
      }
      p.captures[profile] = { excess, lit, frame: p.frame, error: gl.getError(), contextLost: gl.isContextLost() };
      p.pending = null;
    };
  })()`);
}
async function capture(page, profile) {
  await page.evaluate(value => { window.localProbe.pending = value; }, profile);
  await expect.poll(() => page.evaluate(value => !!window.localProbe.captures[value], profile)).toBe(true);
  return page.evaluate(value => window.localProbe.captures[value], profile);
}
async function handDemo(page) {
  await page.evaluate(() => {
    window.fischLive.configureReactive(false);
    window.fischLive.activity({ turn: 'working', output: 0, quality: 'synthetic' });
    window.localFixtureTimer = setInterval(() => window.fischLive.fixture('hand-only', 0.2), 60);
  });
  await expect.poll(() => page.evaluate(() => window.localProbe.x)).toBeGreaterThan(0.07);
  await expect.poll(() => page.evaluate(() => window.localProbe.pupilMax)).toBeGreaterThan(0.005);
  const attention = await page.evaluate(() => window.fischLive.metrics().visualAttention);
  expect(attention.history.some(entry => entry.status === 'started')).toBe(true);
  await page.evaluate(() => window.fischLive.reactiveUserIntent());
  await expect.poll(() => page.evaluate(() => Math.abs(window.localProbe.pupilX))).toBeLessThan(0.001);
  expect(await page.evaluate(() => window.fischLive.metrics().visualAttention.active)).toBeNull();
  await page.evaluate(() => { clearInterval(window.localFixtureTimer); window.fischLive.fixture('hand-lost'); });
  await expect.poll(() => page.evaluate(() => Math.abs(window.localProbe.x))).toBeLessThan(0.01);
  await page.locator('#motion').selectOption('off');
  const frozen = await page.evaluate(() => window.localProbe.frame);
  await page.evaluate(() => window.fischLive.fixture('hand-only', 0.8));
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(await page.evaluate(() => window.localProbe.frame)).toBe(frozen);
  expect(await page.locator('#enable-reactivity').isDisabled()).toBe(true);
}
it('shows a brighter crisp resting body and local hand responses without a semantic provider or real camera', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(server.resolvedUrls.local[0] + 'live.html?fixture=synthetic');
    await page.waitForFunction(() => !!window.fischLive); await probe(page);
    await expect.poll(() => page.evaluate(() => window.localProbe.style)).toEqual({ brightness: 0.95, pointSize: 2.2, dispersion: 0 });
    const prior = await capture(page, 'prior-style'), current = await capture(page, 'live-default');
    expect(prior.lit).toBeGreaterThan(10); expect(current.lit).toBeGreaterThan(10);
    expect(current.excess).toBeGreaterThan(prior.excess); expect(current.error).toBe(0); expect(current.contextLost).toBe(false);
    await handDemo(page);
    expect(await page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    expect(await page.evaluate(() => window.fischLive.metrics().cameraActive)).toBe(false);
    if (process.env.FISCH_LOCAL_REFLEX_EVIDENCE) writeFileSync(process.env.FISCH_LOCAL_REFLEX_EVIDENCE,
      JSON.stringify({ mode: 'synthetic_local_reflex_actual_software_WebGL', semanticModelCalls: 0, realCamera: false, prior, current,
        attention: await page.evaluate(() => window.fischLive.metrics().visualAttention),
        interpretation: 'controlled style ablation and local response, not human legibility/enjoyment or semantic camera understanding' }, null, 2));
  } finally { await browser?.close(); await server.close(); }
}, 60000);
