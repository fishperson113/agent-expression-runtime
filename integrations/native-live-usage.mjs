import { mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, rmdirSync, existsSync, openSync, closeSync, fstatSync, readSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';

const header = JSON.stringify({ schemaVersion: 1, kind: 'native-live-usage' }) + '\n';
export function nativeUsagePaths({ env = process.env, home = homedir(), platform = process.platform } = {}) {
  const path = platform === 'win32' ? win32 : posix;
  const root = platform === 'win32' ? env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
  if (!path.isAbsolute(root)) throw Error('native_usage_path');
  const directory = path.join(root, 'fisch', 'native-live');
  return { directory, state: path.join(directory, 'usage.json'), history: path.join(directory, 'usage.jsonl'), lock: path.join(directory, 'usage.lock') };
}
function state(paths, used) {
  const temporary = paths.state + '.writing-' + randomUUID();
  try { writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, kind: 'native-live-usage', used }) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(temporary, paths.state); }
  finally { rmSync(temporary, { force: true }); }
}
function entry(text) {
  const value = JSON.parse(text);
  if (Object.keys(value).sort().join() !== 'at,id,purpose' || !Number.isSafeInteger(value.id) || value.id < 1 || typeof value.purpose !== 'string'
    || value.purpose.length > 80 || !value.purpose.startsWith('native-observation:') || /[\x00-\x1f\x7f]/.test(value.purpose) || typeof value.at !== 'string'
    || !Number.isFinite(Date.parse(value.at)) || new Date(value.at).toISOString() !== value.at) throw Error('native_usage_invalid');
  return value;
}
function history(paths, full) {
  const file = openSync(paths.history, 'r');
  try {
    const size = fstatSync(file).size;
    const prefix = Buffer.alloc(Buffer.byteLength(header)); readSync(file, prefix, 0, prefix.length, 0);
    if (prefix.toString('utf8') !== header) throw Error('native_usage_invalid');
    if (full) {
      if (size > 64 * 1024 * 1024) throw Error('native_usage_history_size');
      const text = readFileSync(file, 'utf8');
      if (!text.startsWith(header) || !text.endsWith('\n')) throw Error('native_usage_invalid');
      let used = 0;
      for (const line of text.slice(header.length).split('\n').slice(0, -1)) if (entry(line).id !== ++used) throw Error('native_usage_invalid');
      return used;
    }
    const bytes = Buffer.alloc(Math.min(size, 4096)); readSync(file, bytes, 0, bytes.length, size - bytes.length);
    const text = bytes.toString('utf8'); if (!text.endsWith('\n')) throw Error('native_usage_invalid');
    if (size === Buffer.byteLength(header)) { if (text !== header) throw Error('native_usage_invalid'); return 0; }
    return entry(text.slice(0, -1).split('\n').at(-1)).id;
  } finally { closeSync(file); }
}
function read(paths, full = false) {
  const file = openSync(paths.state, 'r'); let value;
  try { if (fstatSync(file).size > 4096) throw Error('native_usage_invalid'); value = JSON.parse(readFileSync(file, 'utf8')); }
  finally { closeSync(file); }
  if (Object.keys(value).sort().join() !== 'kind,schemaVersion,used' || value.schemaVersion !== 1 || value.kind !== 'native-live-usage'
    || !Number.isSafeInteger(value.used) || value.used < 0) throw Error('native_usage_invalid');
  const used = history(paths, full);
  if (used !== value.used && used !== value.used + 1) throw Error('native_usage_invalid');
  if (used !== value.used) state(paths, used);
  return used;
}
function locked(paths, operation) {
  mkdirSync(paths.lock);
  try { return operation(); } finally { rmdirSync(paths.lock); }
}
export function prepareNativeUsage(options = {}) {
  const paths = nativeUsagePaths(options);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  locked(paths, () => {
    if (!existsSync(paths.state) && !existsSync(paths.history)) {
      writeFileSync(paths.history, header, { flag: 'wx', mode: 0o600 });
      writeFileSync(paths.state, JSON.stringify({ schemaVersion: 1, kind: 'native-live-usage', used: 0 }) + '\n', { flag: 'wx', mode: 0o600 });
    }
    read(paths, true);
  });
  return { reserve(requestId, now = Date.now()) {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(requestId) || !Number.isFinite(now)) throw Error('native_usage_arguments');
    return locked(paths, () => {
      const used = read(paths); if (used === Number.MAX_SAFE_INTEGER) throw Error('native_usage_counter');
      appendFileSync(paths.history, JSON.stringify({ id: used + 1, purpose: 'native-observation:' + requestId, at: new Date(now).toISOString() }) + '\n', { mode: 0o600 });
      state(paths, used + 1); return true;
    });
  } };
}
