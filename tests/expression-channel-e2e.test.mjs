import { expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { openLive } from '../integrations/live-launch.mjs';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';
import { gatewayExecutable } from '../scripts/start-session.mjs';
import { ExpressionResponseChannel, expressionResponseSchema, parseExpressionResponse } from '../integrations/expression-response.mjs';
const curveSchema = expressionResponseSchema.$defs.part.anyOf.find(part => part.properties.kind.const === 'curve');
const optionalColor = Object.hasOwn(curveSchema.properties, 'color') ? { color: null } : {};
const response = mode => JSON.stringify({ reply: 'Synthetic response projection.', decision: mode === 'retain'
  ? { mode, reasonCode: 'preserve_current', payload: null }
  : { mode, reasonCode: 'authored_context', payload: { parts: [{ id: 'channel_authored', kind: 'curve', points: [[-0.5, -0.3, 0], [0, 0.7, 0], [0.6, -0.4, 0]], radius: 0.06, weight: null, ...optionalColor, motion: null, trackRef: null, trajectory: null }], tracks: null, base: 'none', durationMs: 300, easing: 'smoothstep', style: { color: '#b34ea7', brightness: 0.95, pointSize: 2.2, dispersion: 0 }, flow: null } } });
function sharedResponse() {
  const value = JSON.parse(response('compose'));
  value.decision.payload.tracks = [{ group: 'mark', pivot: [0, 0, 0], keyframes: [
    { atMs: 0, translate: [0, 0, 0], rotate: [0, 0, 0], easing: null },
    { atMs: 1200, translate: [0.3, 0, 0], rotate: [0, 0, 0.2], easing: 'smoothstep' },
  ] }];
  value.decision.payload.parts[0].trackRef = 'mark';
  return JSON.stringify(value);
}
const result = (mode, shared = false) => ({ threadId: 'owned_thread', turnId: 'owned_turn', status: 'completed', truncated: false, toolRequests: [], messages: [{ id: 'final', text: shared ? sharedResponse() : response(mode) }] });
it('keeps structured channel fixtures valid before gateway admission', () => {
  for (const mode of ['retain', 'compose']) expect(parseExpressionResponse(response(mode)).mode).toBe(mode);
  expect(parseExpressionResponse(sharedResponse()).args.parts[0].trackRef).toBe('mark');
});
const required = process.env.FISCH_CAPABILITY_REQUIRE_GATEWAY === '1';
it.skipIf(!existsSync(gatewayExecutable()) && !required)('projects a structured reply and admits only its owned decision through existing MCP/Rust/WebGL', async () => {
  const live = await openLive({ headless: true, assets: false, production: false }); const client = liveTestClient(live.base, live.token);
  let dispatches = 0;
  try {
    await client.call('initialize');
    const inspect = toolValue(await client.tool('inspect_expression'));
    const channel = new ExpressionResponseChannel({ call: async (method, params) => {
      expect(method).toBe('mcpServer/tool/call'); expect(params.threadId).toBe('owned_thread'); expect(params.server).toBe('fisch_live');
      dispatches++; return client.tool(params.tool, params.arguments);
    } });
    const token = channel.begin({ threadId: 'owned_thread', epoch: inspect.epoch }); channel.bind(token, 'owned_turn');
    expect(await channel.complete(token, result('retain'))).toMatchObject({ dispatch: 'retained', reply: 'Synthetic response projection.' }); expect(dispatches).toBe(0);
    const next = channel.begin({ threadId: 'owned_thread', epoch: inspect.epoch }); channel.bind(next, 'owned_turn');
    const applied = await channel.complete(next, result('compose', true));
    expect(applied.dispatch).toBe('accepted'); expect(applied.visibility).toBe('unknown');
    await expect.poll(async () => toolValue(await client.tool('expression_status', { requestId: next.requestId })).status).toBe('completed');
    await expect.poll(() => live.page.evaluate(() => window.fischLive.metrics().parts)).toEqual(['channel_authored']);
    expect((await channel.complete(next, result('compose', true))).dispatch).toBe('dropped'); expect(dispatches).toBe(1);
    const old = channel.begin({ threadId: 'owned_thread', epoch: inspect.epoch }); channel.bind(old, 'owned_turn');
    await client.tool('cancel_expression');
    expect((await channel.complete(old, result('compose'))).dispatch).toBe('rejected');
    await expect.poll(() => live.page.evaluate(() => window.fischLive.metrics().scene)).toBe('face');
    expect(await live.page.locator('video').evaluate(video => video.srcObject)).toBeNull();
    if (process.env.FISCH_CHANNEL_EVIDENCE) {
      mkdirSync(process.env.FISCH_CHANNEL_EVIDENCE, { recursive: true });
      await live.page.locator('#body').screenshot({ path: process.env.FISCH_CHANNEL_EVIDENCE + '/after-stop.png' });
      writeFileSync(process.env.FISCH_CHANNEL_EVIDENCE + '/result.json', JSON.stringify({ mode: 'scripted_structured_final_existing_mcp_rust_webgl', modelCalls: 0, retainDispatches: 0, composeReceipt: applied.receipt, totalDispatchAttempts: dispatches, lateEpoch: 'rejected', normalNativeStreaming: false }, null, 2));
    }
  } finally { await client.close(); await live.close(); }
}, 60000);

