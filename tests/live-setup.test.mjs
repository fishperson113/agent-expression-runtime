import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { cachedBuild, withSetupLock } from '../scripts/live-build-cache.mjs';
import { ensureLiveDependencies, prepareLiveRuntime } from '../scripts/prepare-live.mjs';
import { prepareModel } from '../scripts/prepare-live-assets.mjs';
import { dispatch, parseLiveOptions } from '../bin/fisch.mjs';

const roots = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'fisch-setup-')); roots.push(root);
  await writeFile(resolve(root, 'input'), 'first');
  return root;
}
it('routes Live preparation flags and the explicit Herdr adapter', async () => {
  const live = vi.fn();
  await dispatch(['live', '--hands', '--agent', 'pane'], { live });
  expect(live).toHaveBeenCalledWith({ hands: true, agentPane: 'pane' });
  expect(parseLiveOptions(['--no-assets'])).toEqual({ assets: false });
  for (const args of [['--hands', '--no-assets'], ['--agent'], ['--bad'], ['--hands', '--hands']]) expect(() => parseLiveOptions(args)).toThrow();
});
it('reuses successful builds and rebuilds after source/output deletion or modification', async () => {
  const root = await fixture(), build = vi.fn(() => writeFile(resolve(root, 'output'), 'built'));
  const options = { root, name: 'test', inputs: ['input'], outputs: ['output'], build, log: () => {} };
  expect(await cachedBuild(options)).toBe(true);
  expect(await cachedBuild(options)).toBe(false);
  await writeFile(resolve(root, 'input'), 'changed'); expect(await cachedBuild(options)).toBe(true);
  await rm(resolve(root, 'output')); expect(await cachedBuild(options)).toBe(true);
  await writeFile(resolve(root, 'output'), 'broken'); expect(await cachedBuild(options)).toBe(true);
  expect(build).toHaveBeenCalledTimes(4);
});
it('never caches failed or mid-build changed input', async () => {
  const root = await fixture(), options = { root, name: 'fail', inputs: ['input'], outputs: ['output'], log: () => {} };
  await expect(cachedBuild({ ...options, build: async () => { throw Error('failed'); } })).rejects.toThrow('failed');
  await expect(cachedBuild({ ...options, build: () => writeFile(resolve(root, 'input'), 'changed') })).rejects.toThrow('Source changed');
  const build = vi.fn(() => writeFile(resolve(root, 'output'), 'okay'));
  await cachedBuild({ ...options, build }); expect(build).toHaveBeenCalledOnce();
});
it('installs locked local dependencies once before runtime imports and retries missing installs', async () => {
  const root = await fixture();
  const run = vi.fn(async () => {
    await mkdir(resolve(root, 'node_modules'), { recursive: true });
    await writeFile(resolve(root, 'node_modules/.package-lock.json'), '{}');
    for (const name of ['vite', '@playwright/test', '@mediapipe/tasks-vision', 'ws']) {
      await mkdir(resolve(root, 'node_modules', name), { recursive: true });
      await writeFile(resolve(root, 'node_modules', name, 'package.json'), '{}');
    }
  });
  await ensureLiveDependencies({ root, run }); await ensureLiveDependencies({ root, run });
  expect(run).toHaveBeenCalledOnce(); expect(run.mock.calls[0][1].slice(-2)).toEqual(['ci', '--include=dev']);
  await rm(resolve(root, 'node_modules'), { recursive: true });
  await ensureLiveDependencies({ root, run }); expect(run).toHaveBeenCalledTimes(2);
});
it('prepares gateway and static assets from checkout, tolerates optional download failure and supports offline mode', async () => {
  const root = await fixture(), prepareAssets = vi.fn(async () => { throw Error('offline'); });
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const run = vi.fn(async () => {
    await mkdir(resolve(root, 'src-tauri/target/debug'), { recursive: true });
    await writeFile(resolve(root, 'src-tauri/target/debug/fisch-gateway' + (process.platform === 'win32' ? '.exe' : '')), 'binary');
  });
  const buildFrontend = vi.fn(async () => { await mkdir(resolve(root, 'dist')); await writeFile(resolve(root, 'dist/live.html'), 'page'); });
  const options = { root, run, buildFrontend, prepareAssets, hands: true };
  await prepareLiveRuntime(options); await prepareLiveRuntime(options);
  expect(run).toHaveBeenCalledOnce(); expect(buildFrontend).toHaveBeenCalledOnce();
  expect(prepareAssets).toHaveBeenCalledWith(resolve(root, 'public/live-assets'), { hands: true, signal: undefined });
  expect(error.mock.calls[0][0]).toContain('Continuing camera-off');
  await prepareLiveRuntime({ ...options, assets: false }); expect(prepareAssets).toHaveBeenCalledTimes(2);
});
it('reuses verified models, repairs corrupt files atomically, and rejects invalid downloads', async () => {
  const root = await fixture(), bytes = Buffer.alloc(100000, 7), hash = createHash('sha256').update(bytes).digest('hex');
  const download = vi.fn(async () => new Response(bytes));
  const args = [root, 'model.task', 'https://example.test/model', hash, download];
  await prepareModel(...args); await prepareModel(...args); expect(download).toHaveBeenCalledOnce();
  await writeFile(resolve(root, 'model.task'), 'corrupt'); await prepareModel(...args); expect(download).toHaveBeenCalledTimes(2);
  expect(await readFile(resolve(root, 'model.task'))).toEqual(bytes);
  await expect(prepareModel(root, 'bad.task', args[2], hash, async () => new Response('bad'))).rejects.toThrow('hash_mismatch');
  await expect(prepareModel(root, 'bad.task', args[2], hash, async () => new Response('', { status: 503 }))).rejects.toThrow('503');
});

it('does not stamp missing outputs and releases setup lock after failure or cancellation', async () => {
  const root = await fixture();
  await expect(cachedBuild({ root, name: 'missing', inputs: ['input'], outputs: ['absent'], build: async () => {} })).rejects.toThrow();
  await expect(withSetupLock(root, () => withSetupLock(root, async () => {}))).rejects.toThrow('Another Fisch launch');
  await expect(withSetupLock(root, async () => 'released')).resolves.toBe('released');
  const abort = new AbortController(); abort.abort(); const build = vi.fn();
  await expect(prepareLiveRuntime({ root, signal: abort.signal, buildFrontend: build })).rejects.toThrow();
  expect(build).not.toHaveBeenCalled();
});
it('does not continue setup after cancellation during asset preparation', async () => {
  const root = await fixture(), abort = new AbortController(), run = vi.fn();
  const prepareAssets = async () => { abort.abort(); throw Error('cancelled'); };
  await expect(prepareLiveRuntime({ root, signal: abort.signal, prepareAssets, run })).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});
