import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function hookPaths(provider, { home = homedir(), env = process.env, platform = process.platform } = {}) {
  const configDir = provider === 'codex' ? env.CODEX_HOME ?? join(home, '.codex') : env.CLAUDE_CONFIG_DIR ?? join(home, '.claude');
  const dataDir = platform === 'win32' ? env.LOCALAPPDATA ?? join(home, 'AppData', 'Local') : env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  return { config: join(configDir, provider === 'codex' ? 'hooks.json' : 'settings.json'),
    runner: join(dataDir, 'fisch', 'hooks', 'hook.mjs') };
}
export function ownedHook(hook) {
  return /\/(?:scripts\/fisch-hook|fisch\/hooks\/hook)\.mjs(?:['"\s]|$)/.test(String(hook.command ?? '').replaceAll('\\', '/'));
}
export function editHookFile(file, edit) {
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const config = edit(before ? JSON.parse(before) : {}), content = JSON.stringify(config, null, 2) + '\n';
  if (content === before || (!before && !Object.keys(config).length)) return;
  mkdirSync(dirname(file), { recursive: true }); const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, content, { mode: 0o600 });
    if ((existsSync(file) ? readFileSync(file, 'utf8') : '') !== before) throw Error('hook_config_changed');
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}
export async function prepareHookRunner(file) {
  const { build } = await import('esbuild');
  mkdirSync(dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await build({ entryPoints: [fileURLToPath(new URL('../scripts/fisch-hook.mjs', import.meta.url))], outfile: temporary,
      bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}
