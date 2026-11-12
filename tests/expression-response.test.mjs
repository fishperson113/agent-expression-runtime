import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ExpressionResponseChannel, expressionResponseSchema, parseExpressionResponse, runChannelTurn } from '../integrations/expression-response.mjs';
const compose = () => ({ reply: 'A normal reply.', decision: { mode: 'compose', reasonCode: 'shared_progress', payload: {
  parts: [{ id: 'authored', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.2, 0.3, 0.1], rotation: null, weight: null, color: null, trajectory: null, motion: null }],
  base: 'none', durationMs: 300, easing: 'smoothstep', style: null, flow: null } } });
const retain = () => ({ reply: '', decision: { mode: 'retain', reasonCode: 'keep_current', payload: null } });
const turn = value => ({ threadId: 'thread', turnId: 'turn', status: 'completed', truncated: false, toolRequests: [], messages: [{ id: 'final', text: JSON.stringify(value), phase: null }] });
function fixture() {
  let at = 0; const call = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ status: 'accepted', epoch: 'epoch', session: 's', seq: 1, requestId: 'host_request' }) }] }));
  const channel = new ExpressionResponseChannel({ call, now: () => at, id: () => 'host_request' });
  const token = channel.begin({ threadId: 'thread', epoch: 'epoch' }); channel.bind(token, 'turn');
  return { call, channel, token, time: value => { at = value; } };
}
it('requires an explicit logical decision while retain preserves the scene without any call', async () => {
  const f = fixture(); expect(await f.channel.complete(f.token, turn(retain()))).toMatchObject({ mode: 'retain', dispatch: 'retained' });
  expect(f.call).not.toHaveBeenCalled(); expect(() => parseExpressionResponse('{"reply":"x"}')).toThrow('response_schema');
});
it('normalizes only declared optional nulls and routes same-thread data to the existing fixed body tools', async () => {
  const f = fixture(); const parsed = parseExpressionResponse(JSON.stringify(compose()));
  expect(parsed.args.parts[0]).not.toHaveProperty('rotation');
  expect((await f.channel.complete(f.token, turn(compose()))).dispatch).toBe('accepted');
  expect(f.call).toHaveBeenCalledWith('mcpServer/tool/call', { threadId: 'thread', server: 'fisch_live', tool: 'compose_expression',
    arguments: { parts: [{ id: 'authored', kind: 'ellipsoid', center: [0, 0, 0], scale: [0.2, 0.3, 0.1] }], base: 'none', durationMs: 300, easing: 'smoothstep', requestId: 'host_request', expectedEpoch: 'epoch' } });
  expect((await f.channel.complete(f.token, turn(compose()))).dispatch).toBe('dropped'); expect(f.call).toHaveBeenCalledTimes(1);
});
it('does not duplicate existing same-turn tool mutations, including started or failed calls', async () => {
  for (const status of ['inProgress', 'failed', 'completed']) {
    const f = fixture(), result = turn(compose()); result.toolRequests = [{ id: 'body', server: 'fisch_live', tool: 'express', status }];
    expect((await f.channel.complete(f.token, result)).dispatch).toBe('suppressed'); expect(f.call).not.toHaveBeenCalled();
  }
});
it('drops incomplete, foreign, ambiguous, malformed or truncated results without fallback effects', async () => {
  for (const change of [t => { t.status = 'interrupted'; }, t => { t.turnId = 'other'; }, t => { t.threadId = 'other'; },
    t => { t.truncated = true; }, t => { delete t.toolRequests; }, t => { t.messages.push({ id: 'extra', text: t.messages[0].text }); },
    t => { t.messages[0].text = 'not json'; }, t => { t.messages[0].text = t.messages[0].text.replace('0.2', '200'); }]) {
    const f = fixture(), result = turn(compose()); change(result);
    expect((await f.channel.complete(f.token, result)).dispatch).toBe('dropped'); expect(f.call).not.toHaveBeenCalled();
  }
});
it('fences new intent, epoch leases, clock rewind and expiry before dispatch', async () => {
  for (const invalidate of [f => f.channel.revoke(), f => f.channel.begin({ threadId: 'thread', epoch: 'new' }), f => f.time(120000), f => f.time(-1)]) {
    const f = fixture(); invalidate(f); expect((await f.channel.complete(f.token, turn(compose()))).dispatch).toBe('dropped'); expect(f.call).not.toHaveBeenCalled();
  }
});
it('records unknown outcomes and revocation after dispatch without replay or pretending cancellation', async () => {
  const f = fixture(); let resolve;
  f.call.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = f.channel.complete(f.token, turn(compose())); f.channel.revoke();
  resolve({ content: [{ type: 'text', text: '{"status":"accepted","epoch":"epoch"}' }] });
  expect(await pending).toMatchObject({ dispatch: 'unknown', reason: 'revoked_after_dispatch' });
  expect((await f.channel.complete(f.token, turn(compose()))).dispatch).toBe('dropped'); expect(f.call).toHaveBeenCalledTimes(1);
  const g = fixture(); g.call.mockResolvedValueOnce({ isError: true, content: [{ type: 'text', text: '{"status":"rejected","code":"http_timeout"}' }] });
  expect((await g.channel.complete(g.token, turn(compose()))).dispatch).toBe('unknown');
});
it('keeps an animation branch rather than forcing all expressive decisions to create geometry', () => {
  const response = { reply: 'Yes.', decision: { mode: 'animate', reasonCode: 'brief_ack', payload: { controls: [], poses: [{ type: 'pose', target: { part: 'body', prop: 'y' }, value: 0.1, durationMs: 500, delayMs: null, attackMs: 100, releaseMs: 100 }], lifetimeMs: 1000 } } };
  expect(parseExpressionResponse(JSON.stringify(response))).toMatchObject({ tool: 'express', args: { body: { type: 'live', program: null } } });
});
it('correlates early events to the ACK, ignores foreign turns, sends per-turn schema and cleans listeners', async () => {
  const events = new EventEmitter(); let sent, reserved = 0;
  const client = { events, call: async (method, args) => {
    if (method !== 'turn/start') return {};
    sent = args; expect(reserved).toBe(1);
    for (const turnId of ['foreign', 'owned']) {
      events.emit('notification', { method: 'item/completed', params: { threadId: 'thread', turnId, item: { id: turnId, type: 'agentMessage', text: JSON.stringify(retain()) } } });
      events.emit('notification', { method: 'turn/completed', params: { threadId: 'thread', turn: { id: turnId, status: 'completed' } } });
    }
    return { turn: { id: 'owned' } };
  } };
  const result = await runChannelTurn(client, 'thread', 'NEW synthetic dev context', { outputSchema: expressionResponseSchema, beforeStart: () => { reserved++; } });
  expect(result.turnId).toBe('owned'); expect(result.messages).toHaveLength(1); expect(sent.outputSchema).toBe(expressionResponseSchema);
  expect(events.listenerCount('notification')).toBe(0); expect(events.listenerCount('closed')).toBe(0);
});
it('never starts a model request when reservation fails', async () => {
  const events = new EventEmitter(), call = vi.fn();
  await expect(runChannelTurn({ events, call }, 'thread', 'dev', { beforeStart: () => { throw Error('budget_exhausted'); } })).rejects.toThrow('budget_exhausted');
  expect(call).not.toHaveBeenCalled(); expect(events.listenerCount('notification')).toBe(0);
});
it('interrupts an acknowledged turn even when its start ACK arrives after the timeout', async () => {
  const events = new EventEmitter(); let acknowledge;
  const call = vi.fn((method) => method === 'turn/start' ? new Promise(resolve => { acknowledge = resolve; }) : Promise.resolve({}));
  const pending = runChannelTurn({ events, call }, 'thread', 'dev', { timeoutMs: 5 });
  await new Promise(resolve => setTimeout(resolve, 15)); acknowledge({ turn: { id: 'late' } });
  await expect(pending).rejects.toThrow('model_turn_timeout');
  expect(call).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread', turnId: 'late' });
  expect(events.listenerCount('notification')).toBe(0);
});

it('treats malformed tool metadata or uncorrelated accepted receipts as unknown evidence', async () => {
  const f = fixture(), malformed = turn(compose()); malformed.toolRequests = [{ id: 'unknown' }];
  expect(await f.channel.complete(f.token, malformed)).toMatchObject({ dispatch: 'dropped', reason: 'trace_incomplete' });
  expect(f.call).not.toHaveBeenCalled();
  for (const receipt of [{ status: 'accepted', epoch: 'epoch' }, { status: 'accepted', epoch: 'epoch', requestId: 'foreign', session: 's', seq: 1 }]) {
    const g = fixture(); g.call.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(receipt) }] });
    expect(await g.channel.complete(g.token, turn(compose()))).toMatchObject({ dispatch: 'unknown', reason: 'receipt_unverified' });
  }
});
it('uses supported output unions while the original host validator still enforces controls', () => {
  expect(JSON.stringify(expressionResponseSchema)).not.toContain('"oneOf"');
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') { expect(node.additionalProperties).toBe(false); expect(node.required).toEqual(Object.keys(node.properties)); }
    Object.values(node).forEach(visit);
  };
  visit(expressionResponseSchema);
});
it('preserves Native terminal errors and retry notifications without projecting them as an expression', async () => {
  const events = new EventEmitter(), error = { message: 'HTTP 400 invalid_json_schema: oneOf is not permitted', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 400 } }, additionalDetails: null };
  const client = { events, call: async () => {
    events.emit('notification', { method: 'error', params: { threadId: 'thread', turnId: 'failed', error, willRetry: false } });
    events.emit('notification', { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'failed', status: 'failed', error } } });
    return { turn: { id: 'failed' } };
  } };
  const result = await runChannelTurn(client, 'thread', 'synthetic');
  expect(result).toMatchObject({ status: 'failed', error, errors: [{ error, willRetry: false }] });
  const f = fixture(); expect((await f.channel.complete(f.token, { ...result, turnId: 'turn' })).dispatch).toBe('dropped'); expect(f.call).not.toHaveBeenCalled();
});
