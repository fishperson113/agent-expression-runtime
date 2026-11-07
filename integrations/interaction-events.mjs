import { createHash } from 'node:crypto';

export const eventKinds = ['user_message', 'work_finished', 'needs_user', 'task_success', 'task_failure', 'interrupted'];
const label = value => typeof value === 'string' ? value.slice(0, 160) : '';
export function redactMessage(text) {
  return String(text ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]').slice(0, 6000);
}
function outcome(input) {
  const response = input.tool_response;
  const code = response?.exit_code ?? response?.exitCode;
  if (input.hook_event_name === 'PostToolUseFailure' || response?.isError === true || (Number.isInteger(code) && code !== 0))
    return 'task_failure';
  const command = input.tool_input?.command ?? input.tool_input?.cmd;
  if (code === 0 && typeof command === 'string' &&
      /(?:^|[;&|]\s*)(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|check)|(?:npx\s+)?vitest|pytest|cargo\s+(?:test|build|check)|go\s+test)\b/i.test(command))
    return 'task_success';
  return null;
}
export function normalizeHook(input, now = Date.now()) {
  if (!input || input.agent_id || !label(input.session_id)) return null;
  const type = { UserPromptSubmit: 'user_message', Stop: 'work_finished', PermissionRequest: 'needs_user',
    Interrupt: 'interrupted' }[input.hook_event_name] ?? outcome(input);
  if (!type) return null;
  const sessionId = label(input.session_id), turnId = label(input.turn_id ?? input.prompt_id);
  const text = type === 'user_message' ? redactMessage(input.prompt) : '';
  if (type === 'user_message' && !text.trim()) return null;
  const key = [sessionId, turnId, type, label(input.tool_use_id), text].join('\0');
  return { id: createHash('sha256').update(key).digest('hex'), sessionId, turnId, type, at: now, text };
}
export function validEvent(value, now = Date.now()) {
  return value && typeof value === 'object' && eventKinds.includes(value.type) &&
    typeof value.id === 'string' && /^[a-f0-9]{64}$/.test(value.id) &&
    typeof value.sessionId === 'string' && value.sessionId.length > 0 && value.sessionId.length <= 160 &&
    typeof value.turnId === 'string' && value.turnId.length <= 160 &&
    Number.isFinite(value.at) && Math.abs(now - value.at) <= 30000 &&
    typeof value.text === 'string' && value.text.length <= 6000;
}
