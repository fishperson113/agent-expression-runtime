import { mkdirSync, lstatSync, readFileSync, writeFileSync, linkSync, unlinkSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function desktopRuntimePaths({ env = process.env, home = homedir(), platform = process.platform } = {}) {
  const path = platform === 'win32' ? win32 : posix;
  const root = platform === 'win32' ? env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
  if (!path.isAbsolute(root)) throw Error('desktop_runtime_unavailable');
  const parent = path.join(root, 'fisch'), directory = path.join(parent, 'desktop-live'), lock = path.join(directory, 'host.lock');
  return { parent, directory, lock, owner: path.join(lock, 'owner.json'), connection: path.join(directory, 'connection.json') };
}
function inspect(path, directory, platform, privateMode = true) {
  const item = lstatSync(path);
  if (item.isSymbolicLink() || (directory ? !item.isDirectory() : !item.isFile()) || !directory && item.size > 2048
    || platform !== 'win32' && (item.uid !== process.getuid() || privateMode && (item.mode & 0o077))) throw Error('desktop_runtime_unavailable');
}
function json(path, platform) { inspect(path, false, platform); return JSON.parse(readFileSync(path, 'utf8')); }
function present(path) { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function directory(path, platform, privateMode = true) { if (!present(path)) mkdirSync(path, { recursive: true, mode: 0o700 }); inspect(path, true, platform, privateMode); }
function connection(value) {
  if (!value || Object.keys(value).sort().join() !== 'base,instance,pid,schemaVersion,token' || value.schemaVersion !== 1
    || !/^[a-f0-9-]{36}$/.test(value.instance) || !Number.isSafeInteger(value.pid) || value.pid < 1 || !/^[a-f0-9]{64}$/.test(value.token)) throw Error('desktop_runtime_unavailable');
  const url = new URL(value.base);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('desktop_runtime_unavailable');
  return value;
}
function owned(paths, platform, instance, pid) {
  inspect(paths.directory, true, platform); inspect(paths.lock, true, platform);
  const owner = json(paths.owner, platform);
  return Object.keys(owner).sort().join() === 'instance,pid' && owner.instance === instance && owner.pid === pid;
}
export function claimDesktopRuntime(options = {}) {
  const platform = options.platform ?? process.platform, paths = desktopRuntimePaths(options), instance = randomUUID(), pid = process.pid;
  directory(paths.parent, platform, false); directory(paths.directory, platform);
  if (present(paths.connection)) throw Error('desktop_host_active');
  try { mkdirSync(paths.lock, { mode: 0o700 }); } catch { throw Error('desktop_host_active'); }
  try { writeFileSync(paths.owner, JSON.stringify({ instance, pid }), { flag: 'wx', mode: 0o600 }); }
  catch { rmdirSync(paths.lock); throw Error('desktop_runtime_unavailable'); }
  return {
    publish({ base, token }) {
      const value = connection({ schemaVersion: 1, instance, pid, base, token });
      if (!owned(paths, platform, instance, pid) || present(paths.connection)) throw Error('desktop_runtime_unavailable');
      const temporary = paths.connection + '.' + instance;
      try { writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); linkSync(temporary, paths.connection); }
      finally { if (present(temporary)) unlinkSync(temporary); }
    },
    close() {
      try {
        if (!owned(paths, platform, instance, pid)) return false;
        if (present(paths.connection)) {
          if (connection(json(paths.connection, platform)).instance !== instance) return false;
          unlinkSync(paths.connection);
        }
        unlinkSync(paths.owner); rmdirSync(paths.lock); return true;
      } catch { return false; }
    }
  };
}
export function readDesktopRuntime(options = {}) {
  const platform = options.platform ?? process.platform, paths = desktopRuntimePaths(options);
  if (!present(paths.connection)) throw Error('desktop_host_not_running');
  try {
    inspect(paths.parent, true, platform, false);
    const value = connection(json(paths.connection, platform));
    if (!owned(paths, platform, value.instance, value.pid)) throw Error('desktop_runtime_unavailable');
    try { if ((options.alive ?? (pid => process.kill(pid, 0)))(value.pid) === false) throw Error(); } catch { throw Error('desktop_host_not_running'); }
    return { base: value.base, token: value.token };
  } catch (error) { throw Error(error.message === 'desktop_host_not_running' ? error.message : 'desktop_runtime_unavailable'); }
}
export function desktopMcpConfig({ node = process.execPath, entry = fileURLToPath(new URL('../bin/fisch.mjs', import.meta.url)) } = {}) {
  return `[mcp_servers.fisch]\ncommand = ${JSON.stringify(node)}\nargs = ${JSON.stringify([entry, 'mcp'])}\nenv_vars = ["XDG_DATA_HOME", "LOCALAPPDATA"]\n`;
}
