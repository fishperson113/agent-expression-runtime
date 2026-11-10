import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

// Retained for terminal geometry/planner reference tests, not a CLI launcher.
const root = fileURLToPath(new URL('../', import.meta.url));
async function bundler() {
  try { return await import('esbuild'); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    const script = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    await new Promise((resolve, reject) => {
      const child = existsSync(script) ? spawn(process.execPath, [script, 'ci'], { cwd: root, stdio: 'inherit', windowsHide: true })
        : spawn('npm', ['ci'], { cwd: root, stdio: 'inherit', windowsHide: true });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('Fisch dependency installation failed.')));
    });
    return import('esbuild');
  }
}
export async function terminalEngine() {
  const { build } = await bundler();
  mkdirSync(resolve(root, '.runtime'), { recursive: true });
  const outfile = resolve(root, `.runtime/terminal-${randomUUID()}.mjs`);
  try {
    await build({ entryPoints: [resolve(root, 'src/terminal/runtime.ts')], outfile,
      bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external' });
    const { TerminalEngine } = await import(pathToFileURL(outfile).href);
    return new TerminalEngine();
  } finally { rmSync(outfile, { force: true }); }
}
