import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import Ajv from 'ajv';
import { Compiler } from '../src/core/compiler/compiler.ts';

const token = 'synthetic-mcp-test-credential-only';
function response(state, request, input) {
  if (request.method === 'DELETE') { state.session = undefined; return {}; }
  if (request.url === '/v1/sessions') {
    const id = String(++state.generation);
    state.session = { id, epoch: id };
    state.compiler = new Compiler(); state.receipts.clear();
    return state.session;
  }
  if (!state.session || !request.url.startsWith(`/v1/sessions/${state.session.id}/`)) throw Error('session');
  if (state.receipts.has(input.requestId)) return state.receipts.get(input.requestId);
  state.commands.push(structuredClone(input));
  if (state.uncertain && input.kind === 'define') {
    const receipt = { status: 'pending' };
    state.receipts.set(input.requestId, receipt); return receipt;
  }
  try {
    state.compiler.compile({ v: 1, epoch: state.session.epoch, seq: ++state.seq,
      kind: input.kind ?? 'program', ...(input.kind === 'define' || input.kind === 'state' ? {} : { track: 'body', policy: 'replace' }),
      body: input.body }, 0);
    const receipt = { status: 'accepted' }; state.receipts.set(input.requestId, receipt); return receipt;
  } catch (error) {
    state.receipts.set(input.requestId, { status: 'rejected', code: error.code }); throw error;
  }
}
async function harness(work, live = false) {
  const state = { generation: 0, seq: 0, compiler: new Compiler(), session: undefined,
    receipts: new Map(), commands: [], uncertain: false };
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end('{}'); return; }
    let bytes = ''; for await (const chunk of req) bytes += chunk;
    try { res.end(JSON.stringify(response(state, req, bytes ? JSON.parse(bytes) : {}))); }
    catch (error) { res.writeHead(422).end(JSON.stringify({ code: error.code ?? error.message, path: error.path })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['integrations/mcp-server.mjs'], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, AER_BASE_URL: `http://127.0.0.1:${server.address().port}`, AER_PAIRING_TOKEN: token, FISCH_LIVE: live ? '1' : '0' },
  });
  let buffer = '', next = 0;
  const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1); pending.get(message.id)?.(message.result);
    }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => reject(Error('MCP timeout')), 8000);
    pending.set(id, result => { clearTimeout(timer); pending.delete(id); resolve(result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try { await work(state, call); }
  finally {
    child.stdin.end();
    await new Promise(resolve => child.once('exit', resolve));
    await new Promise(resolve => server.close(resolve));
  }
}
const define = { kind: 'define', body: { name: 'vui', revision: 1, params: {},
  body: { type: 'morph', target: 'sphere', durationMs: 100 } } };
const macro = { body: { type: 'call', name: 'vui', revision: 1, args: {} } };
const express = (call, args) => call('tools/call', { name: 'express', arguments: args });

it.each(['lease expiry', 'browser refresh', 'compiler reset'])('restores accepted macros after %s', async reason => {
  await harness(async (state, call) => {
    expect((await express(call, define)).isError).not.toBe(true);
    if (reason === 'compiler reset') state.compiler = new Compiler();
    else state.session = undefined;
    const result = await express(call, { ...macro, requestId: 'caller-request-id' });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text).status).toBe('accepted');
    expect(state.commands.filter(command => command.kind === 'define')).toHaveLength(2);
  });
});
it('does not silently replay Live gestures across a lost session, then permits a new explicit request', async () => {
  await harness(async (state, call) => {
    expect((await express(call, define)).isError).not.toBe(true);
    state.session = undefined;
    const blocked = await express(call, macro);
    expect(blocked.isError).toBe(true);
    expect(JSON.parse(blocked.content[0].text).code).toBe('live_session_changed_request_not_replayed');
    expect(state.generation).toBe(1);
    expect((await express(call, macro)).isError).not.toBe(true);
    expect(state.generation).toBe(2);
  }, true);
});
it('does not promote uncertain definitions into the reconnect journal', async () => {
  await harness(async (state, call) => {
    state.uncertain = true;
    expect(JSON.parse((await express(call, define)).content[0].text).status).toBe('pending');
    state.session = undefined; state.uncertain = false;
    const result = await express(call, macro);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).code).toBe('unknown_macro');
    expect(state.commands.filter(command => command.kind === 'define')).toHaveLength(1);
  });
});
it('publishes usable program, state and macro schemas in tools/list', async () => {
  await harness(async (_state, call) => {
    const { tools } = await call('tools/list');
    const validate = new Ajv({ strict: false }).compile(tools[0].inputSchema);
    expect(validate({ body: { type: 'morph', target: 'wall', durationMs: 100 } })).toBe(true);
    expect(validate({ kind: 'state', body: { rise: 0.5, grow: 1 } })).toBe(true);
    expect(validate(define)).toBe(true);
    expect(validate({ body: { type: 'morph', target: 'face', durationMs: 100 } })).toBe(false);
    expect(validate({ body: { type: 'morph' } })).toBe(false);
  });
});
it('returns the exact failing AST path to the agent', async () => {
  await harness(async (_state, call) => {
    const reply = await express(call, { body: { type: 'sequence', children: [
      { type: 'wait', durationMs: 1 }, { type: 'morph', target: 'wall', durationMs: -1 },
    ] } });
    expect(reply.isError).toBe(true);
    expect(JSON.parse(reply.content[0].text)).toMatchObject({ code: 'range', path: '$.body.children[1].durationMs' });
  });
});
it('rejects reusing an ID with a different definition without corrupting the macro journal', async () => {
  await harness(async (state, call) => {
    expect((await express(call, { ...define, requestId: 'fixed' })).isError).not.toBe(true);
    const wrong = await express(call, { kind: 'define', requestId: 'fixed', body: { ...define.body, name: 'wrong' } });
    expect(JSON.parse(wrong.content[0].text).code).toBe('request_id_reused');
    state.session = undefined;
    expect((await express(call, macro)).isError).not.toBe(true);
    expect(state.commands.filter(command => command.kind === 'define').map(command => command.body.name)).toEqual(['vui', 'vui']);
  });
});
