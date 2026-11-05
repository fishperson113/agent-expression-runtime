import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { ExpressionClient } from '../src/integrations/client';
import { Compiler } from '../src/core/compiler/compiler';
import type { ProgramIR } from '../src/core/runtime/ir';
it('HTTP helper and fake MCP host route the same AST into identical core IR without model SDKs', async () => {
  const compiler = new Compiler(),
    outputs: ProgramIR[] = [];
  let seq = 0;
  const token = 'synthetic-test-credential-not-a-secret';
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401);
      res.end('{}');
      return;
    }
    let bytes = '';
    for await (const chunk of req) bytes += chunk;
    const input = bytes ? JSON.parse(bytes) : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/sessions') {
      res.end(JSON.stringify({ id: 'test', epoch: 'e' }));
      return;
    }
    if (req.url?.endsWith('/expressions')) {
      const ir = compiler.compile(
        {
          v: 1,
          epoch: input.epoch,
          seq: ++seq,
          kind: input.kind ?? 'program',
          track: input.track ?? 'body',
          policy: input.policy ?? 'replace',
          body: input.body,
        },
        performance.now(),
      ) as ProgramIR;
      outputs.push(ir);
      res.writeHead(202);
      res.end(
        JSON.stringify({ id: `test:${seq}`, session: 'test', epoch: 'e', seq, status: 'accepted' }),
      );
      return;
    }
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const child = spawn(process.execPath, ['integrations/mcp-server.mjs'], {
    env: { ...process.env, AER_BASE_URL: base, AER_PAIRING_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '',
    next = 0;
  const replies = new Map<number, (value: any) => void>();
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      replies.get(message.id)?.(message);
      replies.delete(message.id);
    }
  });
  const call = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => reject(Error('MCP timeout')), 3000);
      replies.set(id, (v) => {
        clearTimeout(timer);
        resolve(v);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  try {
    const client = new ExpressionClient(base, token);
    await client.connect();
    const body = {
      type: 'parallel' as const,
      children: [
        { type: 'morph' as const, target: 'ring' as const, durationMs: 10000 },
        { type: 'flow' as const, field: 'orbit' as const, strength: 0.4, durationMs: 10000 },
      ],
    };
    await client.express({ body });
    const initialization = await call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fake-host', version: '1' },
    });
    expect(initialization.result.capabilities.tools).toBeDefined();
    const tools = await call('tools/list');
    expect(tools.result.tools[0].inputSchema.properties).not.toHaveProperty('token');
    const start = performance.now();
    const result = await call('tools/call', { name: 'express', arguments: { body } });
    expect(JSON.parse(result.result.content[0].text).status).toBe('accepted');
    expect(performance.now() - start).toBeLessThan(1000);
    expect(outputs[0].ops).toEqual(outputs[1].ops);
    expect(outputs[0].duration).toBe(10000);
    const instructions = await call('resources/read', { uri: 'aer://instructions/v1' });
    expect(instructions.result.contents[0].text).toContain('version 1.0.0');
    expect(instructions.result.contents[0].text).not.toContain(token);
  } finally {
    child.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10000);
