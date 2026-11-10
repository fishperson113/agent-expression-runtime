#!/usr/bin/env node
// Minimal newline-delimited stdio MCP transport. Never logs host credentials.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createLiveTools, liveInputSchema, liveToolDefinitions, liveResource, restingFaceExpression } from './live-tools.mjs';
import { createPlaygroundController } from './playground-controller.mjs';
import { subscribePlaygroundFeedback } from './playground-feedback.mjs';
import { playgroundToolDefinitions } from './playground-tools.mjs';
import { capabilityResource, capabilityResourceList } from './capability-contract.mjs';
import { createExpressionStatus, expressionStatusTool } from './expression-status.mjs';
const base = process.env.AER_BASE_URL,
  token = process.env.AER_PAIRING_TOKEN;
if (!base || !token) {
  console.error('Configure AER_BASE_URL and AER_PAIRING_TOKEN in the host environment.');
  process.exit(1);
}
const url = new URL(base);
if (
  url.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
) {
  console.error('A loopback HTTP base URL is required.');
  process.exit(1);
}
const expressionStatus = createExpressionStatus({ base, token });
const live = process.env.FISCH_LIVE === '1';
const instructions = readFileSync(new URL(live ? './live-instructions.md' : './instructions-v1.md', import.meta.url), 'utf8');
let session, connecting;
const definitions = new Map(), pendingDefinitions = new Map(), commands = new Map();
const protocol = JSON.parse(readFileSync(new URL('../src/contracts/protocol.schema.json', import.meta.url), 'utf8'));
const lifecycleErrors = ['session', 'session_closed', 'stale_epoch', 'http_404'];
async function request(path, body,method=body===undefined?'GET':'POST', timeoutMs=2000) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if(response.status===204)return {};
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error(response.ok ? 'invalid_gateway_response' : `http_${response.status}`);
  }
  if (!response.ok) throw Object.assign(Error(result.code ?? 'gateway_rejected'), { path: result.path, receipt: result });
  return result;
}
const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['body'],
  $defs: protocol.$defs,
  properties: {
    body: {
      anyOf: protocol.oneOf.map(envelope => envelope.properties.body),
      description: 'Program AST by default; use kind=state for baseline patches or kind=define for an immutable macro.',
    },
    kind: { enum: ['program', 'state', 'define'] },
    track: { const: 'body' },
    policy: { enum: ['replace', 'append'] },
    ttlMs: { type: 'integer', minimum: 0, maximum: 5000 },
    requestId: { type: 'string', minLength: 1, maxLength: 128 },
    expectedEpoch: { type: 'string', minLength: 1, maxLength: 128, description: 'Optional host lease fence; reject if cancellation/session replacement changed this epoch. Never replay a mismatch.' },
  },
};
function assertExpectedEpoch(args) {
  const epoch = args?.expectedEpoch;
  if (epoch === undefined) return;
  if (typeof epoch !== 'string' || !epoch || epoch.length > 128) throw Error('invalid_arguments');
  if (epoch !== session?.epoch) throw Error('expected_epoch_mismatch');
}

function tools() {
  return { tools: [
    { name: 'express', description: 'Choose a short particle expression. Read aer://instructions/v1. ACK is admission, not completion.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, inputSchema: live ? liveInputSchema(inputSchema) : inputSchema },
    { name: 'cancel_expression', description: 'Cancel body work and reset posture; keep the agent running.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    expressionStatusTool,
    ...(live ? liveToolDefinitions() : []),
    ...(live ? playgroundToolDefinitions(protocol) : []),
  ] };
}
function resources(params) {
  const uri = params?.uri;
  const capability = capabilityResource(uri); if (capability) return capability;
  if (uri === 'aer://instructions/v1') return { contents: [{ uri, mimeType: 'text/markdown', text: instructions }] };
  if (uri === 'aer://schema/v1') return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(protocol) }] };
  if (live && uri === 'aer://live/v1') return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(liveResource()) }] };
  throw Error('unknown_resource');
}
function remember(args, result) {
  if (args.kind !== 'define') return;
  if (result.status === 'accepted') {
    const key = `${args.body.name}@${args.body.revision}`;
    if (!definitions.has(key) && definitions.size >= 32) throw Error('macro_journal_full');
    definitions.set(key, structuredClone(args));
    pendingDefinitions.delete(args.requestId);
  } else if (result.status === 'pending') pendingDefinitions.set(args.requestId, structuredClone(args));
  else pendingDefinitions.delete(args.requestId);
}
async function send(args) {
  const payload = JSON.stringify(args), previous = commands.get(args.requestId);
  if (previous && previous !== payload) throw Error('request_id_reused');
  commands.set(args.requestId, payload);
  while (commands.size > 256) commands.delete(commands.keys().next().value);
  const held = session, owner = { id: session.id, epoch: session.epoch };
  if (args.expectedEpoch !== undefined && args.expectedEpoch !== owner.epoch) throw Error('expected_epoch_mismatch');
  const { expectedEpoch, ...wireArgs } = args;
  let result;
  try {
    await expressionStatus.begin(args.requestId, owner);
    if (expectedEpoch !== undefined && (session !== held || session?.epoch !== expectedEpoch)) throw Error('expected_epoch_mismatch');
    if (session !== held || session?.id !== owner.id || session?.epoch !== owner.epoch) throw Error('session');
    result = await request(`/v1/sessions/${owner.id}/expressions`, { ...wireArgs, epoch: owner.epoch });
  }
  catch (error) {
    if (['rejected', 'cancelled'].includes(error.receipt?.status)) expressionStatus.receipt(args.requestId, error.receipt);
    else expressionStatus.failed(args.requestId);
    error.requestId = args.requestId;
    throw error;
  }
  expressionStatus.receipt(args.requestId, result);
  remember(args, result);
  return { ...result, requestId: args.requestId };
}
async function settlePending() {
  for (const args of [...pendingDefinitions.values()]) {
    try { await send(args); }
    catch (error) { pendingDefinitions.delete(args.requestId); throw error; }
  }
}
async function restore() {
  for (const definition of definitions.values()) {
    const args = { ...definition, requestId: randomUUID() };
    let result;
    try { result = await send(args); }
    catch (error) { if (error.message === 'immutable_revision') continue; throw error; }
    for (let attempt = 0; result.status === 'pending' && attempt < 4; attempt++) {
      await delay(100);
      result = await send(args);
    }
    if (result.status !== 'accepted') throw Error('macro_restore_pending');
    await delay(110);
  }
}
async function connect() {
  if (session) return;
  connecting ??= (async () => {
    pendingDefinitions.clear(); commands.clear();
    session = await request('/v1/sessions', {});
    try { await restore(); }
    catch (error) {
      const held = session; session = undefined;
      await request(`/v1/sessions/${held.id}`, undefined, 'DELETE').catch(() => {});
      throw error;
    }
  })().finally(() => { connecting = undefined; });
  await connecting;
}
async function invoke(params) {
  if (stopping) throw Error('mcp_closed');
  if (!['express', 'cancel_expression'].includes(params?.name)) throw Error('unknown_tool');
  const args = { ...(params.arguments ?? {}) };
  if (params.name === 'express') {
    if (Object.keys(args).some(key => !Object.hasOwn(inputSchema.properties, key)) ||
        !args.body || typeof args.body !== 'object' || Array.isArray(args.body)) throw Error('invalid_arguments');
    args.requestId ??= randomUUID();
    assertExpectedEpoch(args);
  }
  await connect();
  await settlePending();
  if (params.name === 'express') return send(args);
  const result = await request(`/v1/sessions/${session.id}/cancel`, { epoch: session.epoch });
  expressionStatus.reset('cancel_acknowledged');
  session.epoch = result.epoch;
  pendingDefinitions.clear();
  return result;
}
async function toolCall(params) {
  try {
    if (params?.name === 'express') assertExpectedEpoch(params.arguments);
    if (live && ['express', 'cancel_expression', 'return_to_face'].includes(params?.name)) {
      const owner = playground.interrupt('user_interrupt');
      if (owner) await revokePlayground(owner);
    }
    if (live && params?.name === 'return_to_face') {
      if (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments) || Object.keys(params.arguments).length) throw Error('invalid_arguments');
      params = { name: 'express', arguments: { body: restingFaceExpression() } };
    }
    let result;
    try { result = await invoke(params); }
    catch (error) {
      if (lifecycleErrors.includes(error.message)) {
        expressionStatus.reset('session_changed');
        session = undefined; pendingDefinitions.clear();
        if (live && params.name === 'express') throw Error('live_session_changed_request_not_replayed');
        result = await invoke(params);
      } else if (error.message === 'unknown_macro' && definitions.size) {
        await restore();
        result = await invoke({ ...params, arguments: { ...params.arguments, requestId: randomUUID() } });
      } else throw error;
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    if (lifecycleErrors.includes(error.message)) { expressionStatus.reset('session_changed'); session = undefined; }
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', code: error.message,
      ...(error.path ? { path: error.path } : {}),
      ...(error.requestId ? { requestId: error.requestId } : {}) }) }] };
  }
}
let calls = Promise.resolve();
let playgroundGeneration = 0;
const liveCall = createLiveTools(request, async () => { await connect(); return session; }, () => { expressionStatus.reset('session_changed'); session = undefined; });
const playground = createPlaygroundController({
  currentSession: async () => { await connect(); return { id: session.id, epoch: session.epoch }; },
  send: (args, owner) => {
    if (stopping || !session || session.id !== owner.id || session.epoch !== owner.epoch) throw Error('playground_session_changed');
    return send(args);
  },
  subscribe: (owner, onFeedback, onLost) => subscribePlaygroundFeedback({ base, token, sessionId: owner.id, onFeedback, onLost }),
  invalidate: async owner => {
    await revokePlayground(owner);
    if (stopping) throw Error('playground_closed');
    await connect(); return { id: session.id, epoch: session.epoch };
  },
});
async function revokePlayground(owner) {
  if (!owner || typeof owner.id !== 'string') throw Error('playground_session_changed');
  try { await request(`/v1/sessions/${encodeURIComponent(owner.id)}`, undefined, 'DELETE'); }
  catch (error) { if (!['session', 'session_closed', 'http_404'].includes(error.message)) throw error; }
  if (session?.id === owner.id) { expressionStatus.reset('session_changed'); session = undefined; }
}
const playgroundReply = value => ({ ...(['uncertain', 'rejected'].includes(value.status) ? { isError: true } : {}),
  content: [{ type: 'text', text: JSON.stringify(value) }] });
const playgroundError = error => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'rejected',
  code: /^playground_[a-z_]+$/.test(error?.message) ? error.message : 'playground_failed' }) }] });
async function playgroundRead(args = {}) {
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => key !== 'includeScene') ||
        (args.includeScene !== undefined && typeof args.includeScene !== 'boolean')) throw Error('playground_arguments');
    return playgroundReply(await playground.read(args.includeScene ?? false));
  } catch (error) { return playgroundError(error); }
}
async function playgroundEdit(args) {
  const generation = playgroundGeneration;
  const started = calls.then(() => {
    if (generation !== playgroundGeneration) throw Error('playground_user_interrupt');
    return playground.begin(args);
  });
  calls = started.catch(() => {});
  try { return playgroundReply(await (await started).result); }
  catch (error) { return playgroundError(error); }
}
async function handle(message) {
  const { method, params } = message;
  if (method === 'initialize') return {
    protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {} },
    serverInfo: { name: 'fisch', version: '0.1.0' },
    instructions: instructions,
  };
  if (method === 'ping') return {};
  if (method === 'tools/list') return tools();
  if (method === 'resources/list') return { resources: [
    { uri: 'aer://instructions/v1', name: 'Expression instructions v1', mimeType: 'text/markdown', description: 'Agent authoring, free RGB/motion, priority, privacy and bounded recovery instructions.' },
    { uri: 'aer://schema/v1', name: 'Expression protocol schema v1', mimeType: 'application/json', description: 'Complete declarative program, baseline state and immutable macro schemas.' },
    ...capabilityResourceList(),
    ...(live ? [{ uri: 'aer://live/v1', name: 'Live observations and control schemas', mimeType: 'application/json', description: 'Optional typed observations, continuous controls and declared resting-body geometry; no real camera pixels.' }] : []),
  ] };
  if (method === 'resources/read') return resources(params);
  if (method === 'tools/call') {
    if (params?.name === 'express') {
      try { assertExpectedEpoch(params.arguments); }
      catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', code: error.message }) }] }; }
    }
    if (params?.name === 'expression_status') {
      try { return { content: [{ type: 'text', text: JSON.stringify(expressionStatus.read(params.arguments)) }] }; }
      catch { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', code: 'invalid_arguments' }) }] }; }
    }
    if (live && ['observe', 'look'].includes(params?.name)) return liveCall(params.name, params.arguments);
    if (live && params?.name === 'playground_state') return playgroundRead(params.arguments);
    if (live && (['express', 'cancel_expression', 'return_to_face'].includes(params?.name) ||
        (params?.name === 'playground_edit' && params.arguments?.operation === 'recover'))) {
      playgroundGeneration++; playground.interrupt('user_interrupt');
    }
    if (live && params?.name === 'playground_edit') return playgroundEdit(params.arguments);
    const result = calls.then(() => toolCall(params));
    calls = result.catch(() => {});
    return result;
  }
  throw Error('method_not_found');
}
let inFlight = 0;
let stopping=false;
async function releaseOnExit(){
  if(stopping)return;stopping=true;process.stdin.pause();
  expressionStatus.close();
  await playground.close();
  await calls.catch(()=>{});
  await connecting?.catch(()=>{});
  const held=session;
  session=undefined;
  if(held)await request(`/v1/sessions/${held.id}`,undefined,'DELETE').catch(()=>{});
  process.exit(0);
}
process.stdin.once('end',()=>void releaseOnExit());
process.once('SIGINT',()=>void releaseOnExit());
process.once('SIGTERM',()=>void releaseOnExit());
function line(line) {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.id === undefined) return;
  if (inFlight >= 4) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: m.id,
        error: { code: -32000, message: 'mailbox_full' },
      }) + '\n',
    );
    return;
  }
  inFlight++;
  void handle(m)
    .then((result) =>
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n'),
    )
    .catch(() =>
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: m.id,
          error: { code: -32601, message: 'unsupported_request' },
        }) + '\n',
      ),
    )
    .finally(() => inFlight--);
}
let bytes = [],
  discard = false;
process.stdin.on('data', (chunk) => {
  for (const b of chunk) {
    if (b === 10) {
      if (!discard && bytes.length) line(Buffer.from(bytes).toString('utf8'));
      bytes = [];
      discard = false;
    } else if (!discard) {
      if (bytes.length >= 65536) {
        bytes = [];
        discard = true;
      } else bytes.push(b);
    }
  }
});
