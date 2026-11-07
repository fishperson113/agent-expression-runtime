import { expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, symlinkSync, unlinkSync, rmdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dispatch } from '../bin/fisch.mjs';

it.each(['run', 'build', 'test', 'evaluate', 'doctor'])('routes fisch %s to its handler', async command => {
  const handler = vi.fn(async () => 7);
  expect(await dispatch([command], { [command]: handler })).toBe(7);
  expect(handler).toHaveBeenCalledOnce();
});
it('prints branded help and version without starting the runtime', async () => {
  const exec = promisify(execFile);
  const help = await exec(process.execPath, ['bin/fisch.mjs', '--help']);
  expect(help.stdout).toContain('fisch <command>');
  expect(help.stdout).toContain('evaluate');
  const version = await exec(process.execPath, ['bin/fisch.mjs', '--version']);
  expect(version.stdout).toMatch(/^Fisch \d+\.\d+\.\d+/);
});
it('rejects unknown commands and extra arguments', async () => {
  await expect(dispatch(['unknown'], {})).rejects.toThrow('fisch --help');
  await expect(dispatch(['run', '--unsafe'], { run: vi.fn() })).rejects.toThrow('fisch --help');
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
