import { expect, it } from 'vitest';
import { parsePanelControl } from '../src/live/panel-controls';
const request = (id: string | number = 'r') => ({ type: 'request', id, method: 'item/commandExecution/requestApproval', threadId: 't', turnId: 'u', itemId: 'i', details: { command: 'echo public', cwd: '/public' }, choices: ['accept', 'decline', 'cancel'] });
it('preserves exact typed IDs and clones bounded request details', () => {
  const raw = request(1), parsed = parsePanelControl(raw)!;
  expect(parsed.id).toBe(1); expect(parsePanelControl(request('1'))!.id).toBe('1');
  raw.details.command = 'changed'; expect(parsed.details.command).toBe('echo public');
});
it('rejects getters, cycles, oversize data and session-wide approval choices', () => {
  let reads = 0; const getter = { ...request(), get details() { reads++; return {}; } };
  expect(parsePanelControl(getter)).toBeUndefined(); expect(reads).toBe(0);
  const cycle: any = request(); cycle.details.self = cycle;
  let shared: any = {}; for (let i = 0; i < 4; i++) shared = Array(512).fill(shared);
  expect(parsePanelControl(shared)).toBeUndefined();
  for (const raw of [cycle, { ...request(), details: { command: 'x'.repeat(17000) } }, { ...request(), id: Infinity },
    { ...request(), choices: ['acceptForSession'] }, { ...request(), choices: ['accept', 'accept'] }]) expect(parsePanelControl(raw)).toBeUndefined();
});
it('validates nonsecret question IDs and supported option metadata', () => {
  const raw = { ...request(2), method: 'item/tool/requestUserInput', details: { questions: [{ id: 'choice', header: 'Chọn', question: 'Cách nào?', options: [{ label: 'A', description: 'Một lựa chọn' }], isOther: true }] }, choices: [] };
  expect(parsePanelControl(raw)!.details.questions[0].id).toBe('choice');
  expect(parsePanelControl({ ...raw, details: { questions: [{ ...raw.details.questions[0], id: '__proto__' }] } })).toBeUndefined();
  expect(parsePanelControl({ ...raw, details: { questions: [{ ...raw.details.questions[0], isSecret: true }] } })).toBeUndefined();
  expect(parsePanelControl({ ...raw, details: { questions: [raw.details.questions[0], raw.details.questions[0]] } })).toBeUndefined();
});
it('accepts only canonical lifecycle event phases and resolution reasons', () => {
  const scope = { threadId: 't', turnId: 'u' };
  expect(parsePanelControl({ type: 'resolved', id: 'r', ...scope, reason: 'response_unknown' })!.reason).toBe('response_unknown');
  expect(parsePanelControl({ type: 'resolved', id: 'r', ...scope, reason: 'approved' })).toBeUndefined();
  expect(parsePanelControl({ type: 'tool', phase: 'completed', ...scope, item: { id: 'i', type: 'mcpToolCall', status: 'failed' } })!.item.status).toBe('failed');
  expect(parsePanelControl({ type: 'tool', phase: 'success', ...scope, item: { id: 'i', type: 'mcpToolCall' } })).toBeUndefined();
});
