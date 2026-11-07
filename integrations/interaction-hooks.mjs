import { existsSync, readFileSync, rmSync } from 'node:fs';
import { hookPaths, ownedHook, editHookFile, prepareHookRunner } from './hook-storage.mjs';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function cleanHooks(original) {
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw Error('invalid_hook_config');
  const config = structuredClone(original);
  if (config.hooks === undefined) return config;
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw Error('invalid_hook_config');
  for (const [event, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups)) throw Error('invalid_hook_config');
    const kept = groups.map(group => ({ ...group, hooks: group.hooks.filter(hook => !ownedHook(hook)) })).filter(group => group.hooks.length);
    if (kept.length) config.hooks[event] = kept; else delete config.hooks[event];
  }
  if (!Object.keys(config.hooks).length) delete config.hooks;
  return config;
}
export function hookConfiguration(original, provider, runner = hookPaths(provider).runner) {
  const config = cleanHooks(original); config.hooks ??= {};
  const script = runner.replaceAll('\\', '/');
  if (/[\r\n"%!]/.test(script)) throw Error('unsupported_hook_path');
  const events = ['UserPromptSubmit', 'Stop', 'PermissionRequest', 'PostToolUse',
    ...(provider === 'codex' ? ['Interrupt'] : ['PostToolUseFailure'])];
  for (const event of events) {
    const command = { type: 'command', command: `if [ -n "$HERDR_SOCKET_PATH" ] && [ -n "$HERDR_PANE_ID" ] && [ -f ${quote(script)} ]; then node ${quote(script)} ${provider}; fi`, timeout: 2 };
    if (provider === 'codex') command.commandWindows = `cmd.exe /d /c if defined HERDR_SOCKET_PATH if defined HERDR_PANE_ID if exist "${script}" node "${script}" ${provider}`;
    config.hooks[event] = [...(config.hooks[event] ?? []), { hooks: [command] }];
  }
  return config;
}
export function inspectInteractionHooks(agent, options) {
  const provider = agent.agent?.startsWith('claude') ? 'claude' : 'codex', paths = hookPaths(provider, options);
  try {
    const config = existsSync(paths.config) ? JSON.parse(readFileSync(paths.config, 'utf8')) : {};
    const handlers = Object.values(config.hooks ?? {}).flatMap(groups => groups.flatMap(group => group.hooks)).filter(ownedHook);
    const legacy = handlers.some(hook => String(hook.command).replaceAll('\\', '/').includes('/scripts/fisch-hook.mjs'));
    return { provider, installed: handlers.length > 0 && !legacy && existsSync(paths.runner), legacy,
      review: `/hooks`, installCommand: `fisch hooks install ${provider}` };
  } catch { return { provider, installed: false, error: 'hook_config_unreadable' }; }
}
export async function installInteractionHooks(agent, options) {
  const provider = agent.agent?.startsWith('claude') ? 'claude' : 'codex', paths = hookPaths(provider, options);
  try {
    if (existsSync(paths.config)) cleanHooks(JSON.parse(readFileSync(paths.config, 'utf8')));
    await prepareHookRunner(paths.runner);
    editHookFile(paths.config, config => hookConfiguration(config, provider, paths.runner));
    return inspectInteractionHooks(agent, options);
  } catch { return { provider, installed: false, error: 'hook_install_failed' }; }
}
export function uninstallInteractionHooks(provider, options) {
  const paths = hookPaths(provider, options);
  try {
    editHookFile(paths.config, cleanHooks);
    const remaining = ['codex', 'claude'].some(agent => {
      const state = inspectInteractionHooks({ agent }, options); return state.installed || state.error;
    });
    if (!remaining) rmSync(paths.runner, { force: true });
    return { provider, installed: false, status: 'uninstalled' };
  } catch { return { provider, status: 'rejected', error: 'hook_uninstall_failed' }; }
}
