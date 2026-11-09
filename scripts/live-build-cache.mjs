import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rm, access, open } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function fingerprint(root, paths) {
  const hash = createHash('sha256');
  async function visit(relative) {
    const path = resolve(root, relative);
    try {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isSymbolicLink()) await visit(relative + '/' + entry.name);
      }
    } catch (error) {
      if (error.code === 'ENOENT') { hash.update(relative + ':missing'); return; }
      if (error.code !== 'ENOTDIR') throw error;
      hash.update(relative); hash.update(await readFile(path));
    }
  }
  for (const path of paths) await visit(path);
  return hash.digest('hex');
}
export async function readStamp(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return {}; }
}
export async function cachedBuild({ root, name, inputs, outputs, build, signal, log = console.log }) {
  signal?.throwIfAborted();
  const directory = resolve(root, '.runtime/live-setup');
  const stamp = resolve(directory, name + '.json');
  const before = await fingerprint(root, inputs), previous = await readStamp(stamp);
  const output = await fingerprint(root, outputs);
  if (previous.input === before && previous.output === output) return false;
  await mkdir(directory, { recursive: true });
  await rm(stamp, { force: true });
  log('Fisch: preparing ' + name + ' (first launch or changed files)...');
  signal?.throwIfAborted();
  await build();
  signal?.throwIfAborted();
  if (await fingerprint(root, inputs) !== before) throw Error('Source changed during setup. Run fisch live again.');
  for (const path of outputs) await access(resolve(root, path));
  await writeFile(stamp, JSON.stringify({ input: before, output: await fingerprint(root, outputs) }));
  return true;
}

export async function withSetupLock(root, action, signal) {
  signal?.throwIfAborted();
  const directory = resolve(root, '.runtime/live-setup');
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, 'setup.lock');
  const lock = await acquireLock(path);
  try { await lock.writeFile(String(process.pid)); signal?.throwIfAborted(); return await action(); }
  finally { await lock.close(); await rm(path, { force: true }); }
}
async function acquireLock(path) {
  try { return await open(path, 'wx'); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw Error('Another Fisch launch may be preparing this checkout. Retry after it finishes. If no setup is running, remove only the stale lock at ' + path + ' and retry fisch live.');
  }
}
