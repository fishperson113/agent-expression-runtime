import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const script = fileURLToPath(new URL('../scripts/fisch-hook.mjs', import.meta.url)).replaceAll('\\', '/');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export function hookConfiguration(original, provider) {
  const config = structuredClone(original);
  if (config.hooks !== undefined && (!config.hooks || Array.isArray(config.hooks) || typeof config.hooks !== 'object'))
    throw Error('invalid_hook_config');
  config.hooks ??= {};
  const events = ['UserPromptSubmit', 'Stop', 'PermissionRequest', 'PostToolUse',
    ...(provider === 'codex' ? ['Interrupt'] : ['PostToolUseFailure'])];
  for (const event of events) {
    const groups = config.hooks[event] ?? [];
    if (!Array.isArray(groups)) throw Error('invalid_hook_config');
    const kept = groups.map(group => ({ ...group, hooks: group.hooks.filter(hook =>
      !String(hook.command ?? '').includes('/scripts/fisch-hook.mjs')) })).filter(group => group.hooks.length);
    const command = { type: 'command', command: `node ${quote(script)}`, timeout: 2 };
    if (provider === 'codex') command.commandWindows = `node "${script}"`;
    config.hooks[event] = [...kept, { hooks: [command] }];
  }
  return config;
}
export function installInteractionHooks(agent, { home = homedir(), env = process.env } = {}) {
  const provider = agent.agent?.startsWith('claude') ? 'claude' : 'codex';
  const directory = provider === 'codex' ? env.CODEX_HOME ?? join(home, '.codex') : env.CLAUDE_CONFIG_DIR ?? join(home, '.claude');
  const file = join(directory, provider === 'codex' ? 'hooks.json' : 'settings.json');
  let temporary;
  try {
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const config = hookConfiguration(before ? JSON.parse(before) : {}, provider);
    const content = JSON.stringify(config, null, 2) + '\n';
    if (content !== before) {
      mkdirSync(directory, { recursive: true }); temporary = file + '.' + randomUUID() + '.tmp';
      writeFileSync(temporary, content, { mode: 0o600 });
      if ((existsSync(file) ? readFileSync(file, 'utf8') : '') !== before) throw Error('hook_config_changed');
      renameSync(temporary, file);
    }
    return { provider, installed: true, delivery: 'awaiting-event', review: provider === 'codex' ? '/hooks' : 'reload-if-required' };
  } catch { return { provider, installed: false, error: 'hook_install_failed' }; }
  finally { if (temporary) rmSync(temporary, { force: true }); }
}
