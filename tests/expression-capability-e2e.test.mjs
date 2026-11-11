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

async function inspectEngine(client, live) {
  const inspect = async () => toolValue(await client.tool('inspect_expression', {}));
  const first = await inspect();
  expect(first).toMatchObject({ schemaVersion: 1, source: 'fisch-renderer', format: 'structured' });
  expect(first.summary).toMatchObject({ contextLost: false, color: '#24b7d9', particles: 2000 });
  expect(first.summary.contentFrame).toBeGreaterThan(0);
  expect(first.summary.frame).toBeGreaterThanOrEqual(first.summary.contentFrame);
  expect(first.summary.bounds.min).toHaveLength(3); expect(first.summary.bounds.max.every(Number.isFinite)).toBe(true);
  expect(first.summary.parts.length).toBeGreaterThan(0);
  expect(first.summary.parts.reduce((sum, part) => sum + part.particles, 0)).toBe(first.summary.particles);
  expect(first.summary.parts.filter(part => part.particles > 0).every(part => part.bounds.min.length === 3)).toBe(true);
  expect(Object.keys(first.summary).sort()).toEqual(['bounds','brightness','capturedAt','color','contentFrame','contextLost','frame','particles','parts','pointSize','signature'].sort());
  expect(first.evidence).toContain('not pixels');
  const limited = await client.tool('inspect_expression', {});
  expect(limited.isError).toBe(true); expect(limited.content[0].text).toContain('render_rate_limited');
  expect((await fetch(live.base + '/v1/sessions/' + first.session + '/render-output', { method: 'POST', body: '{}' })).status).toBe(401);
  toolValue(await client.tool('express', { requestId: 'inspect_new_color', body: { type: 'style', color: '#1c73a9', durationMs: 100 } }));
  await completed(client, 'inspect_new_color'); await new Promise(resolve => setTimeout(resolve, 1100));
  const second = await inspect();
  expect(second.summary.color).toBe('#1c73a9'); expect(second.summary.contentFrame).toBeGreaterThan(first.summary.contentFrame);
  expect(second.requestId).not.toBe(first.requestId); expect(second.epoch).toBe(first.epoch);
  await new Promise(resolve => setTimeout(resolve, 1100));
  await live.page.locator('#motion').selectOption('off');
  await live.page.setViewportSize({ width: 1277, height: 901 });
  const frozen = await client.tool('inspect_expression', {});
  expect(frozen.isError).toBe(true); expect(frozen.content[0].text).toContain('render_refresh_unavailable');
  await live.page.locator('#motion').selectOption('normal');
  return { first, second, frozen: 'unavailable despite resize', mode: 'structured output, no image/vision/recognition claim' };
}

async function explicitSceneRecovery(client, live) {
  const call = async (name, args) => toolValue(await client.tool(name, args));
  let state = await call('playground_state', {});
  await call('playground_edit', { operation: 'recover', expectedRevision: state.revision });
  const scene = { parts: [
    { id: 'island', kind: 'ellipsoid', center: [-0.4, 0, 0], scale: [0.25, 0.12, 0.1] },
    { id: 'satellite', kind: 'ellipsoid', center: [0.4, 0.3, 0], scale: [0.1, 0.1, 0.1] }],
    style: { color: '#79b3e7', pointSize: 2, brightness: 0.8, dispersion: 0 }, flow: { field: 'orbit', strength: 0 } };
  state = await call('playground_state', {});
  expect(await call('playground_edit', { operation: 'create', expectedRevision: state.revision, scene })).toMatchObject({ status: 'committed' });
  const retained = await call('playground_state', { includeScene: true }); expect(retained.scene).toEqual(scene);
  // This fixture explicitly requests recovery; cancellation never replays a scene.
  await call('cancel_expression', {});
  await expect.poll(() => live.page.evaluate(() => window.fischLive.metrics().scene)).toBe('face');
  state = await call('playground_state', { includeScene: true }); expect(state.recoveryRequired).toBe(true);
  expect(await call('playground_edit', { operation: 'recover', expectedRevision: state.revision })).toMatchObject({ status: 'recovered' });
  state = await call('playground_state', { includeScene: true }); expect(state.scene).toBeNull();
  expect(await call('playground_edit', { operation: 'create', expectedRevision: state.revision, scene: retained.scene })).toMatchObject({ status: 'committed' });
  const output = await call('inspect_expression', {});
  expect(output.summary.parts.map(part => part.id).sort()).toEqual(['island', 'satellite']);
  return { explicitFreshIntent: true, replayOnCancel: false, restoredFromCallerAuthoredClone: true,
    output, interpretation: 'fresh revision and epoch, not automatic or durable restore, no recognition claim' };
}

const required = process.env.FISCH_CAPABILITY_REQUIRE_GATEWAY === '1';
it.skipIf(!existsSync(gatewayExecutable()) && !required)('keeps the MCP controller exclusive and rejects stale epoch work without replay', async () => {
  const live = await openLive({ headless: true, assets: false, production: false }); let owner, competitor;
  try {
    owner = liveTestClient(live.base, live.token); competitor = liveTestClient(live.base, live.token);
    await owner.call('initialize'); await competitor.call('initialize');
    const args = { requestId: 'controller_contract', body: { type: 'style', color: '#31a7ce', durationMs: 100 } };
    const receipt = toolValue(await owner.tool('express', args));
    expect(receipt.status).toBe('accepted'); await completed(owner, args.requestId);
    const held = await status(owner, args.requestId); expect(held.receipt).toMatchObject({ session: receipt.session, epoch: receipt.epoch, seq: receipt.seq });
    expect(toolValue(await owner.tool('express', args))).toMatchObject({ session: receipt.session, epoch: receipt.epoch, seq: receipt.seq });
    const competing = await competitor.tool('express', { requestId: 'not_a_fork_guard', body: { type: 'style', color: '#ff0000', durationMs: 100 } });
    expect(competing.isError).toBe(true); expect(competing.content[0].text).toContain('controller_active');
    const denied = await fetch(live.base + '/v1/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + live.token } });
    expect(denied.status).toBe(409); expect(await denied.json()).toEqual({ status: 'rejected', code: 'controller_active' });
    const cancelled = toolValue(await owner.tool('cancel_expression'));
    expect(cancelled.epoch).not.toBe(receipt.epoch);
    const before = await live.page.evaluate(value => window.fischLive.metrics().diagnostics.events.filter(event => event.epoch === value.epoch && event.seq === value.seq && event.phase === 'applied').length, receipt);
    const stale = await fetch(live.base + '/v1/sessions/' + receipt.session + '/expressions', { method: 'POST', headers: { Authorization: 'Bearer ' + live.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'stale_controller_contract', epoch: receipt.epoch, body: { type: 'style', color: '#ff0000', durationMs: 100 } }) });
    expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ status: 'rejected', code: 'stale_epoch' });
    const fenced = await owner.tool('express', { requestId: 'fenced_controller_contract', expectedEpoch: receipt.epoch, body: args.body });
    expect(fenced.isError).toBe(true); expect(fenced.content[0].text).toContain('expected_epoch_mismatch');
    expect(toolValue(await owner.tool('express', args))).toMatchObject({ session: receipt.session, epoch: receipt.epoch, seq: receipt.seq });
    const fresh = toolValue(await owner.tool('inspect_expression'));
    expect(fresh.session).toBe(receipt.session); expect(fresh.epoch).toBe(cancelled.epoch); expect(fresh.summary.contextLost).toBe(false);
    expect(fresh.summary.contentFrame).toBeGreaterThan(0);
    const after = await live.page.evaluate(value => window.fischLive.metrics().diagnostics.events.filter(event => event.epoch === value.epoch && event.seq === value.seq && event.phase === 'applied').length, receipt);
    expect(after).toBe(before);
    expect(fresh.summary.color).not.toBe('#ff0000'); expect(await live.page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    if (process.env.FISCH_NATIVE_TEXT_CONTROLLER_EVIDENCE) writeFileSync(process.env.FISCH_NATIVE_TEXT_CONTROLLER_EVIDENCE,
      JSON.stringify({ mode: 'protocol_fixture_actual_stdio_mcp_rust_software_webgl', actualModelCalls: 0, realMedia: false, nativeChatIdentityVerified: false, nativeDictationVerified: false,
        receipt, completed: held, competitor: JSON.parse(competing.content[0].text), competingHttpStatus: denied.status, cancelled,
        staleHttpStatus: stale.status, fenced: JSON.parse(fenced.content[0].text), renderer: fresh, appliedCountBeforeReplay: before, appliedCountAfterReplay: after }, null, 2), { mode: 0o600 });
  } finally { await competitor?.close(); await owner?.close(); await live.close(); }
}, 60000);
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
    results.push(await inspectEngine(client, live));
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
    const pose = toolValue(await client.tool('express', { requestId: 'live_pose_stop', body: {
      type: 'live', program: null, configuration: { controls: [], lifetimeMs: 8000,
        poses: [{ type: 'pose', target: { part: 'body', prop: 'x' }, value: 0.1, durationMs: 8000 }] } } }));
    await expect.poll(async () => (await status(client, 'live_pose_stop')).status).toBe('applied');
    await new Promise(resolve => setTimeout(resolve, 470));
    expect((await status(client, 'live_pose_stop')).status).toBe('applied');
    await live.page.getByRole('button', { name: 'Dừng biểu đạt', exact: true }).click();
    await expect.poll(async () => (await status(client, 'live_pose_stop')).status).toBe('cancelled');
    const stopped = await status(client, 'live_pose_stop');
    expect(stopped.receipt.epoch).toBe(pose.epoch);
    results.push({ requestId: 'live_pose_stop', result: stopped, interpretation: 'stopped early, not an eight-second completion' });
    results.push(await explicitSceneRecovery(client, live));
    const metrics = await live.page.evaluate(() => ({ metrics: window.fischLive.metrics(), maxRise: window.expressionProbe.maxRise }));
    expect(metrics.maxRise).toBeGreaterThan(0.2);
    expect(metrics.metrics.cameraActive).toBe(false);
    expect(await live.page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    expect(metrics.metrics.diagnostics.events.some(event => event.phase === 'frame_submitted')).toBe(true);
    if (process.env.FISCH_CAPABILITY_EVIDENCE) writeFileSync(process.env.FISCH_CAPABILITY_EVIDENCE,
      JSON.stringify({ mode: 'scripted_external_agent_actual_mcp_rust_software_webgl', actualModelCalls: 0, humanAcceptance: 'pending', visibilityTool: 'unknown', inspectionTool: 'structured renderer summary; no image or recognition', results, maxRise: metrics.maxRise, cameraActive: false }, null, 2));
  } finally { await client?.close(); await live.close(); }
}, 90000);
