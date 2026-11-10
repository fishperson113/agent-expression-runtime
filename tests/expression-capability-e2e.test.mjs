import { expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { openLive } from '../integrations/live-launch.mjs';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';
import { gatewayExecutable } from '../scripts/start-session.mjs';

async function probe(page) {
  await page.evaluate(`(async () => {
    const { ThreeRenderer } = await import('/src/adapters/three-renderer.ts');
    const apply = ThreeRenderer.prototype.apply;
    window.expressionProbe = { colors: {}, maxRise: 0 };
    ThreeRenderer.prototype.apply = function(state, now) {
      apply.call(this, state, now);
      const gl = this.renderer.getContext(), width = Math.min(256, gl.drawingBufferWidth), height = Math.min(256, gl.drawingBufferHeight);
      const pixels = new Uint8Array(width * height * 4), corner = new Uint8Array(4 * 4 * 4);
      gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, corner);
      gl.readPixels(Math.floor((gl.drawingBufferWidth-width)/2), Math.floor((gl.drawingBufferHeight-height)/2), width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let foreground = 0, purple = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if ([0,1,2].some(c => Math.abs(pixels[i+c]-corner[c]) > 5)) foreground++;
        if (pixels[i]>corner[0]+8 && pixels[i+2]>corner[2]+8 && pixels[i]>pixels[i+1]+8 && pixels[i+2]>pixels[i]+4) purple++;
      }
      window.expressionProbe.colors[state.color] = { foreground, purple, shader: this.material.uniforms.color.value.getHexString(), contextLost: gl.isContextLost(), error: gl.getError() };
      window.expressionProbe.maxRise = Math.max(window.expressionProbe.maxRise, state.rise);
    };
  })()`);
}
const status = async (client, requestId) => toolValue(await client.tool('expression_status', { requestId }));
async function completed(client, requestId) {
  await expect.poll(async () => (await status(client, requestId)).status, { timeout: 12000 }).toBe('completed');
  const result = await status(client, requestId);
  expect(result.visibility).toBe('unknown');
  return result;
}
async function discovery(client) {
  const initialized = await client.call('initialize');
  expect(initialized.instructions).toContain('#RRGGBB');
  const { tools } = await client.call('tools/list');
  expect(tools.map(tool => tool.name)).toContain('expression_status');
  const listed = await client.call('resources/list');
  for (const uri of ['aer://schema/v1', 'aer://capabilities/v1', 'aer://workflow/v1']) {
    expect(listed.resources.some(resource => resource.uri === uri)).toBe(true);
    const read = await client.call('resources/read', { uri });
    expect(JSON.parse(read.contents[0].text)).toBeTypeOf('object');
  }
}
async function authored(client, page, requestId, color, rise) {
  const args = { requestId, body: { type: 'parallel', children: [
    { type: 'style', color, durationMs: 600 },
    { type: 'shapeQuality', rise, durationMs: 600 },
  ] } };
  const receipt = toolValue(await client.tool('express', args));
  expect(receipt.status).toBe('accepted');
  expect(receipt.requestId).toBe(requestId);
  const result = await completed(client, requestId);
  expect(toolValue(await client.tool('express', args)).seq).toBe(receipt.seq);
  expect((await status(client, requestId)).status).toBe('completed');
  await expect.poll(() => page.evaluate(color => window.expressionProbe.colors[color]?.shader, color)).toBe(color.slice(1));
  const raster = await page.evaluate(color => window.expressionProbe.colors[color], color);
  expect(raster.foreground).toBeGreaterThan(10);
  expect(raster.contextLost).toBe(false); expect(raster.error).toBe(0);
  return { requestId, color, rise, result, raster };
}

const required = process.env.FISCH_CAPABILITY_REQUIRE_GATEWAY === '1';
it.skipIf(!existsSync(gatewayExecutable()) && !required)('discovers, authors, executes, cancels and recovers over actual MCP, Rust and WebGL with camera off', async () => {
  expect(existsSync(gatewayExecutable()), 'Build the standalone gateway for required E2E').toBe(true);
  const live = await openLive({ headless: true, assets: false, production: false }); let client;
  try {
    await probe(live.page); client = liveTestClient(live.base, live.token); await discovery(client);
    expect(await status(client, 'never_submitted')).toMatchObject({ status: 'unknown', visibility: 'unknown' });
    const results = [];
    results.push(await authored(client, live.page, 'free_rgb_a', '#a237c9', 0.35));
    results.push(await authored(client, live.page, 'free_rgb_b', '#db8a24', 0.1));
    results.push(await authored(client, live.page, 'free_rgb_c', '#24b7d9', 0.25));
    expect(results[0].raster.purple).toBeGreaterThan(10);
    const rejected = await client.tool('express', { requestId: 'invalid_color', body: { type: 'style', color: '#notrgb', durationMs: 100 } });
    expect(rejected.isError).toBe(true);
    toolValue(await client.tool('express', { requestId: 'replaced_work', body: { type: 'wait', durationMs: 8000 } }));
    await expect.poll(async () => (await status(client, 'replaced_work')).status).toBe('applied');
    results.push(await authored(client, live.page, 'replacement_intent', '#db8a24', 0.1));
    await expect.poll(async () => (await status(client, 'replaced_work')).status).toBe('cancelled');
    const interrupted = toolValue(await client.tool('express', { requestId: 'interrupt_me', body: { type: 'wait', durationMs: 8000 } }));
    await expect.poll(async () => (await status(client, 'interrupt_me')).status).toBe('applied');
    toolValue(await client.tool('cancel_expression'));
    await expect.poll(() => live.page.evaluate(receipt => window.fischLive.metrics().diagnostics.events.some(event =>
      event.phase === 'cancelled' && event.origin === 'native' && event.epoch === receipt.epoch && event.seq === receipt.seq), interrupted)).toBe(true);
    expect(['unknown', 'cancelled']).toContain((await status(client, 'interrupt_me')).status);
    results.push(await authored(client, live.page, 'explicit_recovery', '#a237c9', 0.2));
    expect(results.at(-1).result.receipt.epoch).not.toBe(interrupted.epoch);
    const metrics = await live.page.evaluate(() => ({ metrics: window.fischLive.metrics(), maxRise: window.expressionProbe.maxRise }));
    expect(metrics.maxRise).toBeGreaterThan(0.2);
    expect(metrics.metrics.cameraActive).toBe(false);
    expect(await live.page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    expect(metrics.metrics.diagnostics.events.some(event => event.phase === 'frame_submitted')).toBe(true);
    if (process.env.FISCH_CAPABILITY_EVIDENCE) writeFileSync(process.env.FISCH_CAPABILITY_EVIDENCE,
      JSON.stringify({ mode: 'scripted_external_agent_actual_mcp_rust_software_webgl', actualModelCalls: 0, humanAcceptance: 'pending', visibilityTool: 'unknown', results, maxRise: metrics.maxRise, cameraActive: false }, null, 2));
  } finally { await client?.close(); await live.close(); }
}, 90000);
