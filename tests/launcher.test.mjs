import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { runSession, stopChild } from '../scripts/start-session.mjs';

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

it.skipIf(process.platform !== 'win32')('passes transient MCP settings to Codex without storing credentials', async () => {
  const child = spawn('pwsh', ['-NoProfile', '-Command',
    'function codex { ConvertTo-Json -Compress -InputObject @($args); $global:LASTEXITCODE = 0 }; & ./scripts/start-browser.ps1 -Agent',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => errors += chunk);
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  expect(errors).toBe('');
  expect(code).toBe(0);
  const args = JSON.parse(output);
  expect(args).toContain('--no-daemon');
  expect(args).toContain('mcp_servers.aer.env_vars=["AER_BASE_URL","AER_PAIRING_TOKEN"]');
  const adapter = JSON.parse(args.find(arg => arg.startsWith('mcp_servers.aer.args=')).split('=').slice(1).join('='));
  expect(adapter).toHaveLength(1);
  expect(existsSync(adapter[0])).toBe(true);
});

const native = process.platform === 'win32' && existsSync('src-tauri/target/debug/agent-expression-runtime.exe');
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
      const reply = await mcp.call('tools/call', {
        name: 'express', arguments: { body: { type: 'morph', target: 'wall', durationMs: 100 } },
      });
      expect(JSON.parse(reply.content[0].text).status).toBe('accepted');
      await context.page.waitForFunction(() => document.querySelector('#shape')?.textContent.includes('wall'));
      expect((await mcp.call('tools/call', { name: 'cancel_expression', arguments: {} })).isError).not.toBe(true);
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
