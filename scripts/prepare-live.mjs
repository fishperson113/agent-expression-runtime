import { stopChild } from './start-session.mjs';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedBuild, withSetupLock } from './live-build-cache.mjs';
import { prepareLiveAssets } from './prepare-live-assets.mjs';

export const setupRoot = fileURLToPath(new URL('../', import.meta.url));
export function setupCommand(command, args, root = setupRoot, signal) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32' });
    child.aerProcessGroup = process.platform !== 'win32';
    const stop = () => { void stopChild(child).catch(reject); };
    signal?.addEventListener('abort', stop, { once: true });
    child.once('close', () => signal?.removeEventListener('abort', stop));
    if (signal?.aborted) stop();
    child.once('error', error => reject(signal?.aborted ? error : Error('Could not start ' + command + '. Run fisch doctor; install the missing prerequisite, then retry fisch live.')));
    child.once('exit', code => code === 0 ? accept() : reject(Error(command + ' failed. See output above, then retry fisch live.')));
  });
}
export function npmInvocation() {
  const script = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  return existsSync(script) ? [process.execPath, [script]] : ['npm', []];
}
export function ensureLiveDependencies(options = {}) {
  return withSetupLock(options.root ?? setupRoot, () => installDependencies(options), options.signal);
}
async function installDependencies({ root = setupRoot, run = setupCommand, signal } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw Error('Fisch Live needs Node.js 22.12 or newer.');
  const [command, prefix] = npmInvocation();
  await cachedBuild({ root, name: 'dependencies', signal, inputs: ['package.json', 'package-lock.json'],
    outputs: ['node_modules/.package-lock.json', ...['vite', '@playwright/test', '@mediapipe/tasks-vision', 'ws'].map(name => 'node_modules/' + name + '/package.json')],
    build: async () => {
      console.log('Fisch: npm ci installs locked project dependencies in this checkout; it may download packages from the configured npm registry. No global tools or settings are installed.');
      await run(command, [...prefix, 'ci', '--include=dev'], root, signal);
    } });
}
export function prepareLiveRuntime(options = {}) {
  return withSetupLock(options.root ?? setupRoot, () => prepareRuntime(options), options.signal);
}
async function prepareRuntime({ root = setupRoot, hands = process.env.FISCH_PREPARE_HANDS === '1', assets = true, production = true,
  run = setupCommand, signal, buildFrontend, prepareAssets = prepareLiveAssets } = {}) {
  if (assets) {
    try { await prepareAssets(resolve(root, 'public/live-assets'), { hands, signal }); }
    catch (error) { signal?.throwIfAborted(); console.error('Fisch: vision assets unavailable (' + error.message + '). Continuing camera-off. Retry fisch live for face assets or fisch live --hands for hand assets.'); }
  }
  const gateway = 'src-tauri/target/debug/fisch-gateway' + (process.platform === 'win32' ? '.exe' : '');
  await cachedBuild({ root, name: 'gateway', signal,
    inputs: ['src-tauri/src', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/build.rs'], outputs: [gateway],
    build: async () => {
      console.log('Fisch: building the local browser gateway with Cargo (locked crates may be downloaded). Rust and a platform compiler must already be installed.');
      await run('cargo', ['build', '--locked', '--no-default-features', '--bin', 'fisch-gateway', '--manifest-path', 'src-tauri/Cargo.toml'], root, signal);
      if (!existsSync(resolve(root, gateway))) throw Error('Gateway build produced no executable. Run fisch doctor.');
    } });
  if (production) await cachedBuild({ root, name: 'frontend', signal,
    inputs: ['src', 'public', 'index.html', 'live.html', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'], outputs: ['dist'],
    build: buildFrontend ?? (async () => { const { build } = await import('vite'); await build({ root }); }) });
}
