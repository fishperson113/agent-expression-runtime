import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

async function renderComparison(page) {
  return page.evaluate(`(async () => {
    const { ThreeRenderer } = await import('/src/adapters/three-renderer.ts');
    const { faceWrites, geometricGazeWrites } = await import('/src/core/live/face.ts');
    const { transformMatrices } = await import('/src/core/live/transforms.ts');
    const original = ThreeRenderer.prototype.apply;
    const state = await new Promise(resolve => {
      ThreeRenderer.prototype.apply = function(value, at) { original.call(this, value, at); ThreeRenderer.prototype.apply = original; resolve(structuredClone(value)); };
    });
    const records = [];
    for (const at of [4500, 5040]) for (const x of [-0.7, 0, 0.7]) for (const profile of ['before', 'after']) {
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      const renderer = new ThreeRenderer(canvas, () => {}, 42); renderer.resize(500, 500, 1); renderer.quality(2000);
      const gaze = profile === 'after' ? geometricGazeWrites({ x, y: 0, strength: 1 }) : ['pupil_left', 'pupil_right'].map((part, index) => ({ target: { part, prop: 'x' }, value: (index ? 0.09 : 0.135) + x * 0.055 }));
      const writes = [{ target: { part: 'body', prop: 'rotateY' }, value: 0.25 }, ...faceWrites('working', 0, 'normal', at, profile === 'after' ? 1 : 0), ...gaze];
      renderer.apply({ ...state, liveMatrices: transformMatrices(writes, state.particleParts) }, at);
      const png = canvas.toDataURL('image/png'), positions = renderer.positions.slice(), groups = state.particleGroups;
      const centroids = {};
      for (const id of ['eye_left', 'eye_right', 'pupil_left', 'pupil_right']) {
        const group = state.particleParts.findIndex(p => p.id === id);
        for (let i = 0; i < renderer.count; i++) for (let axis = 0; axis < 3; axis++) renderer.positions[i * 3 + axis] = groups[i] === group ? positions[i * 3 + axis] : 10000;
        renderer.geometry.attributes.position.needsUpdate = true;
        renderer.renderer.render(renderer.scene, renderer.camera);
        const gl = renderer.renderer.getContext(), pixels = new Uint8Array(500 * 500 * 4), corner = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, corner); gl.readPixels(0, 0, 500, 500, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let weight = 0, cx = 0, cy = 0, minY = 500, maxY = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const w = [0, 1, 2].reduce((n, c) => n + Math.max(0, pixels[i + c] - corner[c]), 0);
          if (w < 15) continue;
          const px = (i / 4) % 500, py = Math.floor(i / 2000); weight += w; cx += px * w; cy += py * w; minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        }
        centroids[id] = { x: cx / weight, y: cy / weight, height: maxY - minY, weight };
      }
      records.push({ at, x, profile, centroids, png, contextLost: renderer.renderSnapshot.contextLost }); renderer.dispose(); canvas.remove();
    }
    return records;
  })()`);
}
it('renders a wider pupil direction range relative to eye outlines through working tilt and blink', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage(); await page.goto(server.resolvedUrls.local[0] + 'live.html?fixture=synthetic');
    await page.waitForFunction(() => window.fischLive?.metrics().parts.includes('pupil_left'));
    const records = await renderComparison(page);
    for (const at of [4500, 5040]) for (const side of ['left', 'right']) {
      const relative = (profile, x) => { const c = records.find(r => r.at === at && r.profile === profile && r.x === x).centroids; return c['pupil_' + side].x - c['eye_' + side].x; };
      const before = relative('before', 0.7) - relative('before', -0.7), after = relative('after', 0.7) - relative('after', -0.7);
      expect(before).toBeGreaterThan(0); expect(after).toBeGreaterThan(before * 1.8);
      const neutral = relative('after', 0); expect(relative('after', 0.7)).toBeGreaterThan(neutral + 3); expect(relative('after', -0.7)).toBeLessThan(neutral - 3);
    }
    for (const record of records) { expect(record.contextLost).toBe(false); expect(Object.values(record.centroids).every(c => c.weight > 0 && Number.isFinite(c.x + c.y))).toBe(true); }
    if (process.env.FISCH_GAZE_EVIDENCE) {
      mkdirSync(process.env.FISCH_GAZE_EVIDENCE, { recursive: true });
      for (const { png, ...record } of records) writeFileSync(`${process.env.FISCH_GAZE_EVIDENCE}/${record.profile}-${record.at}-${record.x}.png`, Buffer.from(png.split(',')[1], 'base64'));
      writeFileSync(`${process.env.FISCH_GAZE_EVIDENCE}/metrics.json`, JSON.stringify({ mode: 'synthetic_software_WebGL_controlled_ablation', camera: false, model: false, records: records.map(({ png, ...record }) => record) }, null, 2));
    }
  } finally { await browser?.close(); await server.close(); }
}, 60000);
