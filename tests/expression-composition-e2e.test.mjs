import { expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { openLive } from '../integrations/live-launch.mjs';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';
import { gatewayExecutable } from '../scripts/start-session.mjs';

async function installProbe(page) {
  await page.evaluate(`(async () => {
    const { ThreeRenderer } = await import('/src/adapters/three-renderer.ts');
    const original = ThreeRenderer.prototype.apply;
    window.compositionProbe = { captures: {} };
    ThreeRenderer.prototype.apply = function(state, at) {
      original.call(this, state, at); const probe = window.compositionProbe;
      if (!probe.pending) return;
      const positions = this.positions.slice(), gl = this.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const raster = {};
      for (const selection of ['face', 'authored']) {
        const groups = new Set(state.particleParts.flatMap((p, i) => p.id.startsWith('agent_') === (selection === 'authored') ? [i] : []));
        for (let i = 0; i < this.count; i++) for (let k = 0; k < 3; k++) this.positions[i * 3 + k] = groups.has(state.particleGroups[i]) ? positions[i * 3 + k] : 10000;
        this.geometry.attributes.position.needsUpdate = true; this.renderer.render(this.scene, this.camera);
        const pixels = new Uint8Array(w * h * 4), bg = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bg); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let lit = 0, x = 0, y = 0;
        for (let i = 0; i < pixels.length; i += 4) if ([0, 1, 2].some(c => pixels[i + c] > bg[c] + 8)) { lit++; x += (i / 4) % w; y += Math.floor(i / 4 / w); }
        raster[selection] = { lit, x: lit ? x / lit : null, y: lit ? y / lit : null };
      }
      this.positions.set(positions); this.geometry.attributes.position.needsUpdate = true; this.renderer.render(this.scene, this.camera);
      probe.captures[probe.pending] = { raster, parts: structuredClone(state.particleParts), output: this.inspectOutput(), png: this.canvas.toDataURL('image/png'), metrics: window.fischLive.metrics() };
      probe.pending = null;
    };
  })()`);
}
async function capture(page, key) {
  await page.evaluate(key => { window.compositionProbe.pending = key; }, key);
  await expect.poll(() => page.evaluate(key => !!window.compositionProbe.captures[key], key)).toBe(true);
  return page.evaluate(key => window.compositionProbe.captures[key], key);
}
async function express(client, requestId, parts, color) {
  const receipt = toolValue(await client.tool('express', { requestId, body: { type: 'parallel', children: [
    { type: 'assemble', parts, durationMs: 300 }, { type: 'style', color, brightness: 0.95, pointSize: 2.2, dispersion: 0, durationMs: 300 },
    { type: 'flow', field: 'pulse', strength: 0, durationMs: 300 }] } }));
  expect(receipt.status).toBe('accepted');
  await expect.poll(async () => toolValue(await client.tool('expression_status', { requestId })).status, { timeout: 12000 }).toBe('completed');
  return receipt;
}
function authoredMark(x = 1.65) {
  return [{ id: 'agent_arc', kind: 'curve', radius: 0.035, points: [[x - 0.2, 1.35, 0.35], [x - 0.1, 1.55, 0.35], [x + 0.17, 1.5, 0.35], [x + 0.24, 1.3, 0.35], [x + 0.08, 1.12, 0.35], [x, 0.98, 0.35], [x, 0.8, 0.35]] },
    { id: 'agent_dot', kind: 'ellipsoid', center: [x, 0.58, 0.35], scale: [0.055, 0.055, 0.05] }];
}
const ordered = parts => [...parts].sort((a, b) => a.id.localeCompare(b.id));
const required = process.env.FISCH_CAPABILITY_REQUIRE_GATEWAY === '1';
it.skipIf(!existsSync(gatewayExecutable()) && !required)('supports standalone authored forms, living avatar composition, remix and cancellation through actual MCP/Rust/WebGL', async () => {
  expect(existsSync(gatewayExecutable())).toBe(true);
  const live = await openLive({ headless: true, assets: false, production: false }); let client;
  try {
    await installProbe(live.page); client = liveTestClient(live.base, live.token); await client.call('initialize');
    const resource = await client.call('resources/read', { uri: 'aer://live/v1' });
    const face = JSON.parse(resource.contents[0].text).restingFace.parts;
    const standalone = [{ id: 'agent_flare', kind: 'curve', radius: 0.055, points: [[0, -0.85, 0], [-0.6, -0.3, 0], [-0.5, 0.35, 0], [-0.2, 0.05, 0], [0.15, 1, 0], [0.3, 0.4, 0], [0.65, -0.2, 0], [0.4, -0.7, 0], [0, -0.85, 0]] }];
    await express(client, 'standalone', standalone, '#f88b37'); const singleEarly = await capture(live.page, 'standalone_early');
    await new Promise(resolve => setTimeout(resolve, 500)); const single = await capture(live.page, 'standalone');
    expect(single.raster.authored.lit).toBeGreaterThan(50); expect(single.raster.face.lit).toBe(0); expect(single.parts).toEqual(standalone);
    const compound = [...face, ...authoredMark()]; await express(client, 'compound', compound, '#59d8c6');
    await live.page.evaluate(() => window.fischLive.activity({ turn: 'idle', output: 0, quality: 'synthetic' }));
    const combinedEarly = await capture(live.page, 'compound_early');
    await new Promise(resolve => setTimeout(resolve, 500)); const combined = await capture(live.page, 'compound');
    expect(combined.raster.face.lit).toBeGreaterThan(100); expect(combined.raster.authored.lit).toBeGreaterThan(20);
    expect(combined.raster.authored.x - combined.raster.face.x).toBeGreaterThan(30);
    expect(combined.metrics.userGeometryLocked).toBe(true); expect(combined.metrics.visualAttention.active).toBeNull();
    await live.page.evaluate(() => window.fischLive.activity({ turn: 'idle', output: 0.8, quality: 'synthetic' }));
    await new Promise(resolve => setTimeout(resolve, 500)); const speaking = await capture(live.page, 'activity');
    const height = value => { const b = value.output.parts.find(p => p.id === 'mouth').bounds; return b.max[1] - b.min[1]; };
    expect(height(speaking)).toBeGreaterThan(height(combined) * 1.4);
    const remixed = [...face, ...authoredMark(1.5)]; await express(client, 'remix', remixed, '#c6a8ff'); const remix = await capture(live.page, 'remix');
    expect(ordered(remix.parts.filter(p => !p.id.startsWith('agent_')))).toEqual(ordered(face));
    expect(ordered(remix.parts.filter(p => p.id.startsWith('agent_')))).toEqual(ordered(authoredMark(1.5)));
    await client.tool('cancel_expression');
    await expect.poll(() => live.page.evaluate(() => window.fischLive.metrics().scene)).toBe('face');
    const stopped = await capture(live.page, 'stopped'); expect(stopped.parts.some(p => p.id.startsWith('agent_'))).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 500)); expect(await live.page.evaluate(() => window.fischLive.metrics().parts.some(id => id.startsWith('agent_')))).toBe(false);
    expect(await live.page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    if (process.env.FISCH_COMPOSITION_EVIDENCE) {
      mkdirSync(process.env.FISCH_COMPOSITION_EVIDENCE, { recursive: true }); const captures = { singleEarly, single, combinedEarly, combined, speaking, remix, stopped };
      for (const [key, value] of Object.entries(captures)) writeFileSync(`${process.env.FISCH_COMPOSITION_EVIDENCE}/${key}.png`, Buffer.from(value.png.split(',')[1], 'base64'));
      writeFileSync(`${process.env.FISCH_COMPOSITION_EVIDENCE}/metrics.json`, JSON.stringify({ mode: 'scripted_authored_fixture_actual_mcp_rust_webgl', modelCalls: 0, realCamera: false, reviewTiming: 'early means after logical completion; single/combined are sampled500ms later, not a measured settle/latency guarantee', recognition: 'human review pending; masks are particle groups, not recognition', captures: Object.fromEntries(Object.entries(captures).map(([key, { png, ...value }]) => [key, value])) }, null, 2));
    }
  } finally { await client?.close(); await live.close(); }
}, 90000);
