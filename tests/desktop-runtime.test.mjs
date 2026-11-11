import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync, statSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claimDesktopRuntime, readDesktopRuntime, desktopRuntimePaths, desktopMcpConfig } from '../integrations/desktop-runtime.mjs';
const roots = [], token = 'a'.repeat(64), base = 'http://127.0.0.1:12345';
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'fisch-desktop-')); roots.push(root); const options = { home: root, env: { XDG_DATA_HOME: root, LOCALAPPDATA: root } }; return { root, options, paths: desktopRuntimePaths(options) }; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('publishes one private owned local capability and removes only its own instance', () => {
  const f = fixture(), owner = claimDesktopRuntime(f.options); owner.publish({ base, token });
  expect(readDesktopRuntime(f.options)).toEqual({ base, token });
  if (process.platform !== 'win32') { expect(statSync(f.paths.connection).mode & 0o077).toBe(0); expect(statSync(f.paths.directory).mode & 0o077).toBe(0); }
  const before = readFileSync(f.paths.connection, 'utf8');
  expect(() => claimDesktopRuntime(f.options)).toThrow('desktop_host_active'); expect(readFileSync(f.paths.connection, 'utf8')).toBe(before);
  expect(owner.close()).toBe(true); expect(owner.close()).toBe(false); expect(existsSync(f.paths.connection)).toBe(false);
  expect(() => readDesktopRuntime(f.options)).toThrow('desktop_host_not_running');
});
it('does not steal or delete corrupt, replaced, or dead host registrations', () => {
  const f = fixture(), owner = claimDesktopRuntime(f.options); owner.publish({ base, token });
  expect(() => readDesktopRuntime({ ...f.options, alive: () => false })).toThrow('desktop_host_not_running');
  const original = JSON.parse(readFileSync(f.paths.connection)); writeFileSync(f.paths.connection, JSON.stringify({ ...original, instance: 'b'.repeat(36) }));
  expect(owner.close()).toBe(false); expect(existsSync(f.paths.lock)).toBe(true);
  writeFileSync(f.paths.connection, '{broken'); expect(() => readDesktopRuntime(f.options)).toThrow('desktop_runtime_unavailable');
  expect(() => claimDesktopRuntime(f.options)).toThrow('desktop_host_active'); expect(readFileSync(f.paths.connection, 'utf8')).toBe('{broken');
});
it('rejects nonlocal addresses without publishing a token', () => {
  for (const invalid of ['https://127.0.0.1:1', 'http://example.com:1', 'http://127.0.0.1:1/?token=x', 'http://u:p@127.0.0.1:1']) {
    const f = fixture(), owner = claimDesktopRuntime(f.options);
    expect(() => owner.publish({ base: invalid, token })).toThrow('desktop_runtime_unavailable'); expect(existsSync(f.paths.connection)).toBe(false); expect(owner.close()).toBe(true);
  }
});
it.skipIf(process.platform === 'win32')('refuses symlinks and unsafe POSIX permissions without changing existing files', () => {
  const f = fixture(), owner = claimDesktopRuntime(f.options); owner.publish({ base, token });
  chmodSync(f.paths.connection, 0o644); expect(() => readDesktopRuntime(f.options)).toThrow('desktop_runtime_unavailable'); chmodSync(f.paths.connection, 0o600); expect(owner.close()).toBe(true);
  const target = join(f.root, 'target'); writeFileSync(target, 'keep'); symlinkSync(target, f.paths.connection);
  expect(() => claimDesktopRuntime(f.options)).toThrow('desktop_host_active'); expect(readFileSync(target, 'utf8')).toBe('keep');
  const g = fixture(); mkdirSync(g.paths.parent, { recursive: true }); symlinkSync(f.root, g.paths.directory);
  expect(() => claimDesktopRuntime(g.options)).toThrow('desktop_runtime_unavailable');
});
it('uses standard Windows/macOS locations and prints static token-free executable arguments', () => {
  expect(desktopRuntimePaths({ platform: 'win32', home: 'C:\\Users\\A B', env: {} }).connection).toBe('C:\\Users\\A B\\AppData\\Local\\fisch\\desktop-live\\connection.json');
  expect(desktopRuntimePaths({ platform: 'darwin', home: '/Users/a', env: {} }).connection).toBe('/Users/a/Library/Application Support/fisch/desktop-live/connection.json');
  const text = desktopMcpConfig({ node: 'C:\\Program Files\\node.exe', entry: 'C:\\My Project\\bin\\fisch.mjs' });
  expect(text).toContain(JSON.stringify(['C:\\My Project\\bin\\fisch.mjs', 'mcp'])); expect(text).not.toMatch(/token|AER_|FISCH_|https?:/i);
});
