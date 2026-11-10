import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { reactiveResponsesAdapter } from '../integrations/reactive-provider.mjs';
let server, browser;
beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
afterAll(async () => { await browser?.close(); await server?.close(); });
it('renders provider-chosen RGB on the actual Live avatar through V2 causal admission', async () => {
  const page = await browser.newPage(), color = '#a237c9';
  try {
    await page.clock.install({ time: new Date('2026-11-10T01:00:00Z') });
    await page.goto(server.resolvedUrls.local[0] + 'live.html?fixture=synthetic');
    await page.waitForFunction(() => !!window.fischLive);
    await page.clock.pauseAt(new Date('2026-11-10T01:00:30Z'));
    await page.evaluate(`(async () => {
      const { ThreeRenderer } = await import('/src/adapters/three-renderer.ts'), apply = ThreeRenderer.prototype.apply;
      ThreeRenderer.prototype.apply = function(state, now) {
        apply.call(this, state, now); window.rgbProbe = { state: state.color, shader: this.material.uniforms.color.value.getHexString(), frame: this.renderSnapshot.frame };
      };
      window.fischLive.configureReactive(true, 1, 2);
      const box = document.querySelector('#enable-reactivity'); box.checked = true; box.dispatchEvent(new Event('change'));
      window.fischLive.fixture('present');
    })()`);
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
    const observed = await page.evaluate(() => ({ probe: window.rgbProbe, metrics: window.fischLive.metrics() }));
    expect(observed.probe.state).toBe(color); expect(observed.probe.shader).toBe(color.slice(1)); expect(observed.probe.frame).toBeGreaterThan(0);
    expect(observed.metrics.cameraActive).toBe(false);
    expect(observed.metrics.diagnostics.events.some(event => event.actionId === 'rgb_action' && event.phase === 'applied')).toBe(true);
  } finally { await page.close(); }
}, 30000);
