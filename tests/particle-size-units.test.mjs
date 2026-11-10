import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { Compiler } from '../src/core/compiler/compiler.ts';
import { composeExpression } from '../integrations/compose-expression.mjs';

it('preserves valid small/zero sprite sizes and intentional zero brightness in compiled programs', () => {
  for (const pointSize of [0, 0.035, 3]) {
    const result = composeExpression({ parts: [{ id: 'authored', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.5, 0.5, 0.5] }],
      style: { pointSize, brightness: 0 }, durationMs: 100 });
    const ir = new Compiler().compile({ v: 1, epoch: 'units', seq: 1, kind: 'program', track: 'body', ...result }, 0);
    expect(ir.ops.find(op => op.property === 'pointSize').value).toBe(pointSize);
    expect(ir.ops.find(op => op.property === 'brightness').value).toBe(0);
  }
});
function probeDocument() {
  return { name: 'particle-units-document', configureServer(server) {
    server.middlewares.use('/particle-units', (_req, response) => {
      response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Particle size units probe</title>');
    });
  } };
}
async function measure(page) {
  return page.evaluate(`(async () => {
    const { ThreeRenderer } = await import('/src/adapters/three-renderer.ts');
    const { initialState } = await import('/src/core/runtime/scheduler.ts');
    const records = [];
    function raster(gl) {
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4), bg = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bg);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let excess = 0, lit = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const value = [0, 1, 2].reduce((sum, c) => sum + Math.max(0, pixels[i + c] - bg[c]), 0);
        excess += value; if (value > 15) lit++;
      }
      return { lit, excess };
    }
    for (const dpr of [1, 2]) for (const [pointSize, brightness] of [[0, 0.9], [0.035, 0.9], [3, 0.9], [3, 0]]) {
      const canvas = document.createElement('canvas'); canvas.style.width = '300px'; canvas.style.height = '300px'; document.body.append(canvas);
      const renderer = new ThreeRenderer(canvas, () => {}, 42); renderer.resize(300, 300, dpr); renderer.quality(2000);
      const state = { ...initialState(), color: '#79D9CF', pointSize, brightness, dispersion: 0, flowStrength: 0, effortFlow: 0 };
      renderer.apply(state, 4500);
      const gl = renderer.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
      let positionsHash = 2166136261;
      for (const value of new Uint32Array(renderer.positions.buffer, 0, 6000)) positionsHash = Math.imul(positionsHash ^ value, 16777619) >>> 0;
      records.push({ dpr, pointSize, brightness, requestedSize: renderer.inspectOutput().pointSize,
        requestedBrightness: renderer.inspectOutput().brightness, positionsHash, ...raster(gl),
        pointRange: Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)),
        width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, cssWidth: canvas.getBoundingClientRect().width, cssHeight: canvas.getBoundingClientRect().height, backend: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        error: gl.getError(), contextLost: gl.isContextLost() });
      renderer.dispose(); canvas.remove();
    }
    return records;
  })()`);
}
it('measures settled sprite size and fade profiles at DPR1/2 without assuming universal tiny-point invisibility', async () => {
  const server = await createServer({ plugins: [probeDocument()], server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.addInitScript("window.mediaRequests=0;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{window.mediaRequests++;throw Error('No media permitted')}");
    await page.goto(server.resolvedUrls.local[0] + 'particle-units');
    const records = await measure(page);
    for (const dpr of [1, 2]) {
      const rows = records.filter(row => row.dpr === dpr), normal = rows.find(row => row.pointSize === 3 && row.brightness === 0.9);
      const tiny = rows.find(row => row.pointSize === 0.035), faded = rows.find(row => row.brightness === 0);
      expect(normal.lit).toBeGreaterThan(0); expect(faded.excess).toBe(0);
      expect(new Set(rows.map(row => row.positionsHash)).size).toBe(1);
      if (normal.pointRange[0] < 3 * dpr * 0.75 && normal.pointRange[1] >= 3 * dpr * 1.25) expect(normal.excess).toBeGreaterThan(tiny.excess);
      for (const row of rows) {
        expect(row.requestedSize).toBe(row.pointSize); expect(row.requestedBrightness).toBe(row.brightness);
        expect(row.width).toBe(300 * dpr); expect(row.height).toBe(300 * dpr); expect(row.cssWidth).toBe(300); expect(row.cssHeight).toBe(300);
        expect(row.error).toBe(0); expect(row.contextLost).toBe(false);
      }
    }
    expect(await page.evaluate(() => window.mediaRequests)).toBe(0);
    if (process.env.FISCH_PARTICLE_UNITS_EVIDENCE) writeFileSync(process.env.FISCH_PARTICLE_UNITS_EVIDENCE, JSON.stringify({
      mode: 'settled_seeded_sphere_software_WebGL', seed: 42, time: 4500, particles: 2000, modelCalls: 0, cameraMic: false,
      interpretation: 'Mechanical unit/raster profiles only; no semantic recognition, interrupted-target or human legibility claim.', records }, null, 2));
  } finally { await browser?.close(); await server.close(); }
}, 60000);
