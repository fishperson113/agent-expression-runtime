#!/usr/bin/env node
// Minimal newline-delimited stdio MCP transport. Never logs host credentials.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
const instructions = readFileSync(new URL('./instructions-v1.md', import.meta.url), 'utf8');
let session, connecting;
async function request(path, body,method=body===undefined?'GET':'POST') {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(2000),
  });
  if(response.status===204)return {};
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error(response.ok ? 'invalid_gateway_response' : `http_${response.status}`);
  }
  if (!response.ok) throw Error(result.code ?? 'gateway_rejected');
  return result;
}
const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['body'],
  properties: {
    body: {
      type: 'object',
      description:
        'Complete valid AST node, state patch, or macro definition; see aer://instructions/v1 and protocol schema.',
    },
    kind: { enum: ['program', 'state', 'define'] },
    track: { const: 'body' },
    policy: { enum: ['replace', 'append'] },
    ttlMs: { type: 'integer', minimum: 0, maximum: 5000 },
    requestId: { type: 'string', minLength: 1, maxLength: 128 },
  },
};
async function handle(message) {
  const { method, params } = message;
  if (method === 'initialize')
    return {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'agent-expression-runtime', version: '0.1.0' },
      instructions:
        'Load aer://instructions/v1 into agent context. Host owns pairing credentials. Tool ACK is admission only; content parallelism depends on your host.',
    };
  if (method === 'ping') return {};
  if (method === 'tools/list')
    return {
      tools: [
        {
          name: 'express',
          description:
            'Choose a short declarative particle-body expression. ACK means admitted, not animation completed. Use sphere/wall/pin/screw/pyramid/wave/cloud; orbit/turbulence/pulse; sequence/parallel/wait/style/shapeQuality. Never send code or per-frame coordinates. Read aer://instructions/v1.',
          inputSchema,
        },
        {
          name: 'cancel_expression',
          description:
            'Cancel only body expressions and obtain a new runtime epoch. Does not cancel your agent run.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    };
  if (method === 'resources/list')
    return {
      resources: [
        {
          uri: 'aer://instructions/v1',
          name: 'Expression instructions v1',
          mimeType: 'text/markdown',
        },
        {
          uri: 'aer://schema/v1',
          name: 'Expression protocol schema v1',
          mimeType: 'application/json',
        },
      ],
    };
  if (method === 'resources/read') {
    const uri = params?.uri;
    if (uri === 'aer://instructions/v1')
      return { contents: [{ uri, mimeType: 'text/markdown', text: instructions }] };
    if (uri === 'aer://schema/v1')
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: readFileSync(
              new URL('../src/contracts/protocol.schema.json', import.meta.url),
              'utf8',
            ),
          },
        ],
      };
    throw Error('unknown_resource');
  }
  if (method === 'tools/call') {
    try {
      if (!session) {
        connecting ??= request('/v1/sessions', {}).finally(() => {
          connecting = undefined;
        });
        session = await connecting;
      }
      let result;
      if (params.name === 'express') {
        const args = params.arguments ?? {};
        const allowed = Object.keys(inputSchema.properties);
        if (
          Object.keys(args).some((k) => !allowed.includes(k)) ||
          !args.body ||
          typeof args.body !== 'object'
        )
          throw Error('invalid_arguments');
        result = await request(`/v1/sessions/${session.id}/expressions`, {
          ...args,
          epoch: session.epoch,
          requestId: args.requestId ?? randomUUID(),
        });
      } else if (params.name === 'cancel_expression') {
        result = await request(`/v1/sessions/${session.id}/cancel`, { epoch: session.epoch });
        session.epoch = result.epoch;
      } else throw Error('unknown_tool');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) {
      // Definitive lifecycle rejection: reconnect on the next call, never replay an uncertain command.
      if (['session', 'session_closed', 'stale_epoch', 'http_404'].includes(e.message))
        session = undefined;
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', code: e.message }) }],
      };
    }
  }
  throw Error('method_not_found');
}
let inFlight = 0;
let stopping=false;
async function releaseOnExit(){
  if(stopping)return;stopping=true;process.stdin.pause();
  const held=session??await connecting?.catch(()=>undefined);
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
