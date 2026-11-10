import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { openLive, liveRoot } from '../integrations/live-launch.mjs';

async function installProbe(page) {
  await page.evaluate(`(async () => {
    const { ThreeRenderer } = await import('/src/adapters/three-renderer.ts'), apply = ThreeRenderer.prototype.apply;
    window.olvRaster = { colors: {} };
    ThreeRenderer.prototype.apply = function(state, now) {
      apply.call(this, state, now);
      const gl = this.renderer.getContext(), w = Math.min(256, gl.drawingBufferWidth), h = Math.min(256, gl.drawingBufferHeight);
      const pixels = new Uint8Array(w*h*4), corner = new Uint8Array(64);
      gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, corner);
      gl.readPixels(Math.floor((gl.drawingBufferWidth-w)/2), Math.floor((gl.drawingBufferHeight-h)/2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let cyan = 0, orange = 0;
      for (let i=0; i<pixels.length; i+=4) {
        const [r,g,b] = pixels.subarray(i,i+3);
        if (b>corner[2]+8 && g>r+8 && b>g+4) cyan++;
        if (r>corner[0]+8 && r>g+8 && g>b+8) orange++;
      }
      window.olvRaster.colors[state.color.toLowerCase()] = { shader: this.material.uniforms.color.value.getHexString(), cyan, orange, error: gl.getError(), contextLost: gl.isContextLost() };
      window.olvRaster.last = state.color.toLowerCase();
    };
  })()`);
}
function fixture(live) {
  const child = spawn(process.env.FISCH_OLV_PYTHON, ['scripts/olv-fixture.py', '--upstream', process.env.FISCH_OLV_UPSTREAM,
    '--fisch', liveRoot, '--base', live.base, '--hold', '1'], {
    cwd: liveRoot, env: { ...process.env, AER_PAIRING_TOKEN: live.token }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const events = []; let buffer = '', bytes = 0, stderr = '';
  child.stdout.on('data', chunk => {
    bytes += chunk.length; if (bytes > 65536) { child.kill(); return; }
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end+1);
      try { events.push(JSON.parse(line)); } catch { child.kill(); }
    }
  });
  child.stderr.on('data', chunk => { stderr = (stderr+String(chunk).replaceAll(live.token, '[redacted]')).slice(-8192); });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('OLV fixture timed out')); }, 45000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(events) : reject(Error('OLV fixture failed: '+stderr)); });
  });
  return { child, done };
}
const configured = !!process.env.FISCH_OLV_PYTHON && !!process.env.FISCH_OLV_UPSTREAM;
it.skipIf(!configured && process.env.FISCH_OLV_REQUIRE_TRIAL !== '1')('runs upstream OLV conversation and MCP components through Fisch rendering, interruption and context recovery', async () => {
  expect(configured, 'Set the validated Python environment and pinned upstream checkout').toBe(true);
  const live = await openLive({ headless: true, assets: false, production: false }); let run;
  try {
    await installProbe(live.page); run = fixture(live); const events = await run.done;
    expect(events.find(event => event.kind === 'baseline_unsafe_overlap')).toMatchObject({ reproduced: true, tool_calls: 0 });
    expect(events.find(event => event.kind === 'delayed_rpc_fenced')).toMatchObject({ code: 'expected_epoch_mismatch', synthetic_schedule: true });
    const expressions = events.filter(event => event.kind === 'express').map(event => event.result);
    expect(expressions).toHaveLength(2); expect(expressions.every(receipt => receipt.status === 'accepted')).toBe(true);
    expect(expressions[1].epoch).not.toBe(expressions[0].epoch);
    expect(events.find(event => event.kind === 'before_interrupt_status').result.status).toBe('applied');
    expect(events.find(event => event.kind === 'interrupt').result.status).toBe('cancelled');
    expect(events.filter(event => event.kind === 'context').map(event => event.prior_items)).toEqual([0, 2]);
    expect(events.some(event => event.kind === 'backend_interrupt' && event.heard_chars > 0)).toBe(true);
    expect(events.some(event => event.kind === 'upstream_event' && event.type === 'audio' && event.audioIsNull)).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: 'complete', paid_model_calls: 0, synthetic_provider: true, visible: 'unknown' });
    const proof = await live.page.evaluate(() => ({ raster: window.olvRaster, metrics: window.fischLive.metrics() }));
    expect(proof.raster.colors['#37b2e9']).toMatchObject({ shader: '37b2e9', error: 0, contextLost: false });
    expect(proof.raster.colors['#e78a31']).toMatchObject({ shader: 'e78a31', error: 0, contextLost: false });
    expect(proof.raster.colors['#37b2e9'].cyan).toBeGreaterThan(10);
    expect(proof.raster.colors['#e78a31'].orange).toBeGreaterThan(10);
    expect(proof.raster.last).toBe('#e78a31');
    expect(proof.raster.colors).not.toHaveProperty('#ab39d7');
    for (const receipt of expressions) expect(proof.metrics.diagnostics.events.some(event => event.phase === 'cancelled' &&
      event.origin === 'native' && event.epoch === receipt.epoch && event.seq === receipt.seq)).toBe(true);
    expect(proof.metrics.cameraActive).toBe(false);
    expect(await live.page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    if (process.env.FISCH_OLV_EVIDENCE) writeFileSync(process.env.FISCH_OLV_EVIDENCE, JSON.stringify({ mode: 'actual_upstream_components_scripted_provider_rust_software_webgl', events, raster: proof.raster, cameraActive: false, actualModelCalls: 0, humanAcceptance: 'pending' }, null, 2));
  } finally { run?.child.kill(); await live.close(); }
}, 90000);
