import { expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, symlinkSync, unlinkSync, rmdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openControl } from '../integrations/terminal-ipc.mjs';
import { liveControl } from '../scripts/live-session.mjs';
import { dispatch } from '../bin/fisch.mjs';

it.each(['build', 'test', 'evaluate', 'doctor'])('routes fisch %s to its handler', async command => {
  const handler = vi.fn(async () => 7);
  expect(await dispatch([command], { [command]: handler })).toBe(7);
  expect(handler).toHaveBeenCalledOnce();
});
it('prints branded help and version without starting the runtime', async () => {
  const exec = promisify(execFile);
  const help = await exec(process.execPath, ['bin/fisch.mjs', '--help']);
  expect(help.stdout).toContain('fisch <command>');
  expect(help.stdout).toContain('evaluate');
  expect(help.stdout).toContain('live [--hands] [--no-assets]');
  expect(help.stdout).not.toMatch(/^  (run|express|cancel)\s/m);
  const version = await exec(process.execPath, ['bin/fisch.mjs', '--version']);
  expect(version.stdout).toMatch(/^Fisch \d+\.\d+\.\d+/);
});
it('rejects unknown commands and extra arguments', async () => {
  await expect(dispatch(['unknown'], {})).rejects.toThrow('fisch --help');
  await expect(dispatch(['build', '--unsafe'], { build: vi.fn() })).rejects.toThrow('fisch --help');
  const handler = vi.fn();
  await expect(dispatch(['unknown'], { unknown: handler })).rejects.toThrow('fisch --help');
  expect(handler).not.toHaveBeenCalled();
});
it('requires explicit hook installation and supports actual install/status/uninstall commands', async () => {
  await expect(dispatch(['hooks', 'install'], {})).rejects.toThrow('install codex|claude');
  const home = mkdtempSync(join(tmpdir(), 'fisch-hook-cli-'));
  const env = { ...process.env, CODEX_HOME: join(home, 'codex'), CLAUDE_CONFIG_DIR: join(home, 'claude'),
    LOCALAPPDATA: home, XDG_DATA_HOME: home };
  const command = async args => JSON.parse((await promisify(execFile)(process.execPath, ['bin/fisch.mjs', 'hooks', ...args], { env })).stdout);
  try {
    expect((await command(['install', 'codex']))[0].installed).toBe(true);
    expect((await command(['status', 'codex']))[0].installed).toBe(true);
    expect((await command(['uninstall']))[0].status).toBe('uninstalled');
    expect((await command(['status', 'codex']))[0].installed).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it('executes through a linked checkout, as npm link launches it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fisch-cli-')), link = join(directory, 'checkout');
  try {
    symlinkSync(resolve('.'), link, process.platform === 'win32' ? 'junction' : 'dir');
    const { stdout } = await promisify(execFile)(process.execPath, [join(link, 'bin/fisch.mjs'), '--version']);
    expect(stdout).toMatch(/^Fisch /);
  } finally {
    if (existsSync(link)) unlinkSync(link);
    rmdirSync(directory);
  }
});

it.each([['run'], ['run', '--agent', 'pane'], ['run', '--help'], ['express', '{}'], ['cancel']])('rejects removed terminal command %j with migration guidance', async (...args) => {
  const handler = vi.fn();
  await expect(dispatch(args, { [args[0]]: handler })).rejects.toMatchObject({ public: true, message: expect.stringContaining('Use fisch live') });
  expect(handler).not.toHaveBeenCalled();
});
it('reports removed commands as unsuccessful CLI invocations without launching Live', async () => {
  await expect(promisify(execFile)(process.execPath, ['bin/fisch.mjs', 'run'])).rejects.toMatchObject({
    code: 1, stdout: '', stderr: expect.stringContaining('fisch run has been removed'),
  });
});
it('keeps npm start on Live and capabilities independent of the retired launcher', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.scripts.start).toBe('node bin/fisch.mjs live');
  const { stdout } = await promisify(execFile)(process.execPath, ['bin/fisch.mjs', 'capabilities']);
  const contract = JSON.parse(stdout);
  expect(contract.capabilities).toEqual(JSON.parse(readFileSync(new URL('../src/contracts/capabilities.json', import.meta.url), 'utf8')));
  expect(contract.schema).toHaveProperty('$schema');
  expect(contract.instructions).toContain('morph');
});
it('preserves status and stop for the explicit Live Herdr adapter', async () => {
  const pane = 'cli-' + randomUUID(), namespace = 'live-cli-' + randomUUID(), stop = vi.fn();
  const server = await openControl(pane, liveControl({}, stop), namespace);
  const env = { ...process.env, HERDR_PANE_ID: pane, HERDR_SOCKET_PATH: namespace };
  const command = async name => JSON.parse((await promisify(execFile)(process.execPath, ['bin/fisch.mjs', name], { env })).stdout);
  try {
    expect(await command('status')).toMatchObject({ status: 'live', hookEvents: 0 });
    expect(await command('stop')).toEqual({ status: 'stopped' });
    expect(stop).toHaveBeenCalledOnce();
  } finally { await server.close(); }
  await expect(dispatch(['status', '--all'], {})).rejects.toThrow('Unexpected option');
  await expect(dispatch(['stop', 'other-pane'], {})).rejects.toThrow('Unexpected option');
});

it('routes Desktop host and fast MCP separately without changing Live', async () => {
  const desktop = vi.fn(async () => 4), mcp = vi.fn(async () => 5);
  expect(await dispatch(['desktop', '--mcp-config'], { desktop })).toBe(4);
  expect(desktop).toHaveBeenCalledWith({ config: true });
  expect(await dispatch(['mcp'], { mcp })).toBe(5);
  await expect(dispatch(['mcp', '--hands'], { mcp })).rejects.toThrow();
  await expect(dispatch(['desktop', '--mcp-config', '--hands'], { desktop })).rejects.toThrow();
  await expect(dispatch(['desktop', '--agent', 'pane'], { desktop })).rejects.toThrow();
});
it('prints static Desktop config and fails missing-host MCP without bootstrap or stdout noise', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fisch-desktop-cli-'));
  const env = { ...process.env, XDG_DATA_HOME: home, LOCALAPPDATA: home };
  try {
    const config = await promisify(execFile)(process.execPath, ['bin/fisch.mjs', 'desktop', '--mcp-config'], { env });
    expect(config.stdout).toContain('[mcp_servers.fisch]');
    expect(config.stdout).toContain('"mcp"');
    expect(config.stdout).not.toMatch(/token|AER_|FISCH_/i);
    expect(config.stderr).toBe('');
    expect(existsSync(join(home, 'fisch'))).toBe(false);
    await expect(promisify(execFile)(process.execPath, ['bin/fisch.mjs', 'mcp'], { env })).rejects.toMatchObject({
      code: 1, stdout: '', stderr: expect.stringContaining('desktop_host_not_running'),
    });
    expect(existsSync(join(home, 'fisch'))).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
