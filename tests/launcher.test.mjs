import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { runSession, stopChild, codexArguments, gatewayExecutable } from '../scripts/start-session.mjs';

function mcpClient(base, token) {
  const child = spawn(process.execPath, ['integrations/mcp-server.mjs'], {
    env: { ...process.env, AER_BASE_URL: base, AER_PAIRING_TOKEN: token },
    stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  });
  let buffer = '', id = 0;
  const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      pending.get(message.id)?.(message.result);
    }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => { pending.delete(next); reject(Error('MCP timeout')); }, 5000);
    pending.set(next, result => { clearTimeout(timer); pending.delete(next); resolve(result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
  });
  return { child, call };
}

async function admitted(call, args) {
  const arguments_ = { ...args, requestId: randomUUID() };
  let reply;
  await expect.poll(async () => {
    reply = await call('tools/call', { name: 'express', arguments: arguments_ });
    return JSON.parse(reply.content[0].text).status;
  }, { timeout: 1500, interval: 100 }).toBe('accepted');
  return reply;
}

it('passes transient MCP settings to Codex without storing credentials', () => {
  const args = codexArguments();
  expect(args).toContain('--no-daemon');
  expect(args).toContain('mcp_servers.aer.env_vars=["AER_BASE_URL","AER_PAIRING_TOKEN"]');
  const adapter = JSON.parse(args.find(arg => arg.startsWith('mcp_servers.aer.args=')).split('=').slice(1).join('='));
  expect(adapter).toHaveLength(1);
  expect(existsSync(adapter[0])).toBe(true);
  expect(gatewayExecutable('win32')).toMatch(/runtime\.exe$/);
  expect(gatewayExecutable('linux')).toMatch(/runtime$/);
  expect(gatewayExecutable('darwin')).toMatch(/runtime$/);
});

const native = existsSync(gatewayExecutable());
it.skipIf(!native)('auto-pairs the real browser and admits an MCP expression, then cleans up', async () => {
  let base, origin, gateway;
  const result = await runSession({ headless: true, runHost: async context => {
    ({ base, origin, gateway } = context);
    expect(await context.page.locator('#browser-token').inputValue()).toBe('');
    expect(context.page.url()).not.toContain(context.token);
    const mcp = mcpClient(base, context.token);
    try {
      const initialized = await mcp.call('initialize', {});
      expect(initialized.serverInfo.name).toBe('agent-expression-runtime');
      const resource = await mcp.call('resources/read', { uri: 'aer://instructions/v1' });
      expect(resource.contents[0].text).toContain('morph');
      await admitted(mcp.call, { body: { type: 'morph', target: 'wall', durationMs: 100 } });
      await context.page.waitForFunction(() => document.querySelector('#shape')?.textContent.includes('wall'));
      expect((await mcp.call('tools/call', { name: 'cancel_expression', arguments: {} })).isError).not.toBe(true);
      await admitted(mcp.call, { kind: 'define', body: { name: 'afterRefresh', revision: 1,
        params: {}, body: { type: 'wait', durationMs: 10 } } });
      await context.page.reload();
      await context.page.waitForFunction(() => document.querySelector('#gateway-status')?.textContent.includes('Listening'));
      await admitted(mcp.call, { body: { type: 'call', name: 'afterRefresh', revision: 1, args: {} } });
      return 0;
    } finally { await stopChild(mcp.child); }
  } });
  expect(result).toBe(0);
  expect(gateway.exitCode !== null || gateway.signalCode !== null).toBe(true);
  await expect(fetch(base, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
  await expect(fetch(origin, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
}, 45000);

it.skipIf(!native)('cleans up the engine when the host fails', async () => {
  let gateway;
  await expect(runSession({ headless: true, runHost: async context => {
    gateway = context.gateway;
    throw Error('synthetic host failure');
  } })).rejects.toThrow('synthetic host failure');
  expect(gateway.exitCode !== null || gateway.signalCode !== null).toBe(true);
}, 45000);
