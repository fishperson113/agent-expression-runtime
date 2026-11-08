import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export function probeReply(method, params, image, record = () => {}) {
  if (method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: { tools: {} },
    serverInfo: { name: 'fisch-live-probe', version: '1' },
    instructions: 'Synthetic integration test. Call observe and look before answering.' };
  if (method === 'tools/list') return { tools: ['observe', 'look'].map(name => ({ name,
    description: name === 'look' ? 'Return a synthetic visual test image, never a camera image.' : 'Read synthetic user observations.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } })) };
  if (method === 'ping') return {};
  if (method !== 'tools/call') throw Error('unsupported_method');
  record(params.name);
  if (params.name === 'observe') return { content: [{ type: 'text', text: JSON.stringify({ v: 1,
    synthetic: true, user: { present: true, facingScreen: false }, summary: 'Dữ liệu giả: người dùng có mặt, quay đầu khỏi camera.' }) }] };
  if (params.name === 'look') return { content: [{ type: 'text', text: 'Synthetic fixture. Identify its shape, color and digits from pixels.' },
    { type: 'image', mimeType: 'image/png', data: image }] };
  throw Error('unknown_tool');
}

export function serveProbe(input = process.stdin, output = process.stdout) {
  const image = readFileSync(process.env.FISCH_PROBE_IMAGE).toString('base64');
  const record = tool => appendFileSync(process.env.FISCH_PROBE_CALLS, JSON.stringify({ tool, at: Date.now() }) + '\n');
  createInterface({ input }).on('line', line => {
    let message;
    try {
      message = JSON.parse(line);
      if (message.id === undefined) return;
      const result = probeReply(message.method, message.params, image, record);
      output.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
    } catch {
      if (message?.id !== undefined) output.write(JSON.stringify({ jsonrpc: '2.0', id: message.id,
        error: { code: -32601, message: 'probe_request_failed' } }) + '\n');
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) serveProbe();
