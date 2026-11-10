import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { reactiveResponsesAdapter } from '../integrations/reactive-provider.mjs';
let server, browser;
beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
afterAll(async () => { await browser?.close(); await server?.close(); });
async function installRasterProbe(page) {
  await page.evaluate(`(async () => {
    const { ThreeRenderer } = await import('/src/adapters/three-renderer.ts'), apply = ThreeRenderer.prototype.apply;
    function raster(renderer) {
      const gl = renderer.getContext(), before = gl.getError();
      const width = Math.min(256, gl.drawingBufferWidth), height = Math.min(256, gl.drawingBufferHeight);
      const corner = new Uint8Array(4 * 4 * 4), pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, corner);
      gl.readPixels(Math.floor((gl.drawingBufferWidth - width) / 2), Math.floor((gl.drawingBufferHeight - height) / 2), width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const background = Array.from(corner.slice(0, 3)); let foreground = 0, purple = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = pixels.subarray(i, i + 3);
        if (Math.max(...background.map((value, channel) => Math.abs(value - pixels[i + channel]))) > 5) foreground++;
        if (r > background[0] + 8 && b > background[2] + 8 && r > g + 8 && b > r + 4) purple++;
      }
      return { width, height, background, foreground, purple, errorBefore: before, errorAfter: gl.getError(), contextLost: gl.isContextLost() };
    }
    ThreeRenderer.prototype.apply = function(state, now) {
      apply.call(this, state, now);
      if (!window.rgbBaseline) window.rgbBaseline = raster(this.renderer);
      const previous = window.rgbProbe?.raster;
      window.rgbProbe = { state: state.color, shader: this.material.uniforms.color.value.getHexString(), frame: this.renderSnapshot.frame,
        raster: state.color === '#a237c9' ? raster(this.renderer) : previous };
    };
    window.fischLive.configureReactive(true, 1, 2);
    const box = document.querySelector('#enable-reactivity'); box.checked = true; box.dispatchEvent(new Event('change'));
    window.fischLive.fixture('present');
  })()`);
}
it('renders provider-chosen RGB on the actual Live avatar through V2 causal admission', async () => {
  const page = await browser.newPage(), color = '#a237c9';
  try {
    await page.clock.install({ time: new Date('2026-11-10T01:00:00Z') });
    await page.goto(server.resolvedUrls.local[0] + 'live.html?fixture=synthetic');
    await page.waitForFunction(() => !!window.fischLive);
    await page.clock.pauseAt(new Date('2026-11-10T01:00:30Z'));
    await installRasterProbe(page);
    await page.clock.runFor(1100); await page.evaluate(() => window.fischLive.fixture('present'));
    await page.clock.runFor(800);
    const candidate = await page.evaluate(() => {
      window.fischLive.fixture('present'); const candidate = window.fischLive.takeReactiveRequest();
      if (!candidate || !window.fischLive.authorizeReactiveRequest(candidate.request.requestId)) throw Error('missing_request'); return candidate;
    });
    const provider = reactiveResponsesAdapter({ enabled: true, model: 'fixture', endpoint: 'http://127.0.0.1:1/responses', contractVersion: 2 }, {
      reserve: () => true, fetch: async (_url, options) => {
        const sent = JSON.parse(options.body); expect(sent.instructions).toContain('Choose any #RRGGBB color');
        const value = { schemaVersion: 2, requestId: candidate.request.requestId, decisionId: 'rgb_decision', mode: 'express',
          validUntil: candidate.request.deadline, prerequisites: [], action: { actionId: 'rgb_action', body: { type: 'sequence', children: [{ type: 'parallel',
            children: [{ type: 'style', color, durationMs: 500 }] }] } } };
        return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }));
      },
    });
    const decision = await provider.decide(candidate.observationWindow);
    expect((await page.evaluate(value => window.fischLive.deliverReactiveDecision(value.requestId, value), decision)).reason).toBe('accepted');
    await page.clock.runFor(550);
    const observed = await page.evaluate(() => ({ baseline: window.rgbBaseline, probe: window.rgbProbe, metrics: window.fischLive.metrics() }));
    expect(observed.probe.state).toBe(color); expect(observed.probe.shader).toBe(color.slice(1)); expect(observed.probe.frame).toBeGreaterThan(0);
    for (const raster of [observed.baseline, observed.probe.raster]) {
      expect(raster.contextLost).toBe(false); expect(raster.errorBefore).toBe(0); expect(raster.errorAfter).toBe(0);
      expect(raster.foreground).toBeGreaterThan(10);
    }
    expect(observed.probe.raster.background).toEqual(observed.baseline.background);
    expect(observed.probe.raster.purple).toBeGreaterThan(10);
    expect(observed.probe.raster.purple).toBeGreaterThan(observed.baseline.purple + 10);
    if (process.env.FISCH_RGB_EVIDENCE) writeFileSync(process.env.FISCH_RGB_EVIDENCE, JSON.stringify({ baseline: observed.baseline, after: observed.probe.raster }, null, 2));
    expect(observed.metrics.cameraActive).toBe(false);
    expect(observed.metrics.diagnostics.events.some(event => event.actionId === 'rgb_action' && event.phase === 'applied')).toBe(true);
  } finally { await page.close(); }
}, 30000);
