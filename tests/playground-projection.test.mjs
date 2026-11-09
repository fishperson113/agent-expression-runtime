import { expect, it } from 'vitest';
import { PlaygroundProjection } from '../integrations/playground-projection.mjs';

const start = (turn = 'a', thread = 't') => ({ method: 'turn/started', params: { threadId: thread, turn: { id: turn } } });
const state = (extra = {}) => ({ revision: 1, scenes: 1, recoveryRequired: false, pending: null, closed: false, ...extra });
const item = (method, id, tool = 'playground_edit', value = state({ status: 'committed' }), extra = {}) => ({ method, params: {
  threadId: 't', turnId: 'a', item: { id, type: 'mcpToolCall', server: 'fisch_live', tool, status: method === 'item/started' ? 'inProgress' : 'completed',
    arguments: { operation: 'create', scene: { goal: 'private argument' } },
    result: { content: [{ type: 'text', text: JSON.stringify(value) }] }, ...extra }
} });
function selected() { const p = new PlaygroundProjection(); p.select('t'); p.accept(start()); return p; }
function complete(p, id = 'one', tool, value, extra) {
  p.accept(item('item/started', id, tool, value, { ...extra, status: 'inProgress' }));
  return p.accept(item('item/completed', id, tool, value, extra));
}

it('projects actual native MCP lifecycle using only bounded redacted fields', () => {
  const p = selected();
  expect(p.accept(item('item/started', 'one'))).toEqual({ status: 'working', revision: 0, scenes: 0, recoveryRequired: false, operation: 'create' });
  const result = p.accept(item('item/completed', 'one', 'playground_edit', state({ status: 'committed',
    scene: { goal: 'private result', parts: ['private geometry'] }, code: 'private error', bytes: 999, pending: null })));
  expect(result).toEqual({ status: 'stored', revision: 1, scenes: 1, recoveryRequired: false, operation: 'create' });
  expect(JSON.stringify(result)).not.toMatch(/private|scene"|goal|bytes|code|thread|turn|one/);
  result.revision = 999;
  expect(complete(p, 'two', 'playground_state', state())).toEqual({ status: 'stored', revision: 1, scenes: 1, recoveryRequired: false });
});

it('selects only through explicit successful-selection callback and preserves repeated selection', () => {
  const p = new PlaygroundProjection();
  expect(p.accept(start())).toBeNull();
  expect(p.accept(item('item/started', 'one'))).toBeNull();
  expect(p.select('t')).toEqual({ status: 'unknown', revision: 0, scenes: 0, recoveryRequired: false });
  p.accept(start()); complete(p);
  expect(p.select('t')).toBeNull();
  expect(p.select('other')).toEqual({ status: 'unknown', revision: 0, scenes: 0, recoveryRequired: false });
  expect(p.accept(item('item/completed', 'one'))).toBeNull();
  expect(p.accept({ id: 7, result: { thread: { id: 't' } } })).toBeNull();
});

it('rejects foreign, missing, stale, duplicate and unpaired events without exposing payloads', () => {
  const p = selected();
  const proper = item('item/started', 'one');
  for (const change of [{ threadId: 'other' }, { turnId: 'old' }, { threadId: undefined }, { turnId: undefined }])
    expect(p.accept({ ...proper, params: { ...proper.params, ...change } })).toBeNull();
  for (const change of [{ server: 'other' }, { tool: 'express' }, { id: undefined }, { type: 'agentMessage' }])
    expect(p.accept({ ...proper, params: { ...proper.params, item: { ...proper.params.item, ...change } } })).toBeNull();
  expect(p.accept(item('item/completed', 'never-started'))).toBeNull();
  complete(p);
  expect(p.accept(item('item/completed', 'one'))).toBeNull();
  p.accept({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'a', status: 'completed' } } });
  expect(p.accept(start('a'))).toBeNull();
  expect(p.accept(item('item/started', 'late'))).toBeNull();
});

it('keeps interrupted active work distinct and ignores every late success in that turn', () => {
  const p = selected(); p.accept(item('item/started', 'one'));
  expect(p.accept({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'a', status: 'interrupted' } } }))
    .toEqual({ status: 'interrupted', revision: 0, scenes: 0, recoveryRequired: false, operation: 'create' });
  expect(p.accept(item('item/completed', 'one'))).toBeNull();
  expect(p.accept(start('a'))).toBeNull();
  p.accept(start('b'));
  expect(p.accept(item('item/completed', 'one'))).toBeNull();
});

it('does not invent rollback when an already committed creation is followed by turn interruption', () => {
  const p = selected(); complete(p);
  expect(p.accept({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'a', status: 'interrupted' } } })).toBeNull();
});

it.each([
  [state({ revision: 0, scenes: 0 }), 'empty'],
  [state({ recoveryRequired: true }), 'uncertain'],
  [state({ pending: { transaction: 'private transaction', stage: 'admitted' } }), 'working'],
  [state({ pending: { stage: 'desynchronized' }, recoveryRequired: true }), 'uncertain']
])('maps native playground_state snapshots without sending private journal data', (value, status) => {
  expect(complete(selected(), 'one', 'playground_state', value)).toEqual({ status, revision: value.revision, scenes: value.scenes, recoveryRequired: value.recoveryRequired });
});

it('accepts actual recovery result only as an explicit recover tool outcome', () => {
  const p = selected(); complete(p);
  expect(complete(p, 'recover', 'playground_edit', state({ status: 'recovered', revision: 0, scenes: 0 }), { arguments: { operation: 'recover' } }))
    .toEqual({ status: 'recovered', revision: 0, scenes: 0, recoveryRequired: false, operation: 'recover' });
});

it.each([
  'not JSON private error', 'x'.repeat(65537), JSON.stringify(state({ status: 'committed', scene: { goal: 'x'.repeat(65536) } })), JSON.stringify({ status: 'committed' }),
  JSON.stringify(state({ status: 'committed', revision: -1 })), JSON.stringify(state({ status: 'committed', revision: Number.MAX_SAFE_INTEGER + 1 })),
  JSON.stringify(state({ status: 'committed', scenes: 13 })), JSON.stringify(state({ status: 'committed', recoveryRequired: 'false' })),
  JSON.stringify(state({ status: 'accepted' })), JSON.stringify(state({ status: 'recovered', revision: 0, scenes: 0 }))
])('fails closed on malformed/ambiguous native content without raw errors', text => {
  const p = selected(); p.accept(item('item/started', 'one'));
  const result = p.accept(item('item/completed', 'one', 'playground_edit', {}, { result: { content: [{ type: 'text', text }] } }));
  expect(result.status).toBe('uncertain'); expect(Object.keys(result).sort()).toEqual(['operation', 'recoveryRequired', 'revision', 'scenes', 'status']);
  expect(result.revision).toBe(0); expect(result.scenes).toBe(0);
});

it('uses authoritative uncertain fields but never trusts an error-wrapped success', () => {
  const p = selected();
  const uncertain = state({ status: 'uncertain', recoveryRequired: true });
  expect(complete(p, 'one', 'playground_edit', uncertain, { status: 'failed', result: { content: [{ type: 'text', text: JSON.stringify(uncertain) }] } }).recoveryRequired).toBe(true);
  const result = complete(p, 'two', 'playground_edit', state({ status: 'committed', revision: 2 }), { result: { isError: true, content: [{ type: 'text', text: JSON.stringify(state({ status: 'committed', revision: 2 })) }] } });
  expect(result.status).toBe('uncertain'); expect(result.revision).toBe(1);
});

it('rejects a late older snapshot after a newer revision has already completed', () => {
  const p = selected();
  p.accept(item('item/started', 'old', 'playground_state'));
  complete(p, 'new', 'playground_edit', state({ status: 'committed', revision: 2 }));
  expect(p.accept(item('item/completed', 'old', 'playground_state', state({ revision: 1 })))).toBeNull();
});

it.each([{ status: 'failed', result: null, error: { message: 'private transport detail' } },
  { status: 'failed', result: null }, { status: 'inProgress' }, { status: undefined }])('does not trust failed/null or contradictory native item status', extra => {
  const p = selected(); p.accept(item('item/started', 'one'));
  const result = p.accept(item('item/completed', 'one', 'playground_edit', state({ status: 'committed' }), extra));
  expect(result.status).toBe('uncertain'); expect(JSON.stringify(result)).not.toContain('private');
});

it.each([undefined, 'private invalid operation', 'recover'])('does not certify a committed edit without a valid mutation operation (%s)', operation => {
  const result = complete(selected(), 'one', 'playground_edit', state({ status: 'committed' }), { arguments: { operation } });
  expect(result.status).toBe('uncertain'); expect(JSON.stringify(result)).not.toContain('private');
});

it('blocks pre-recovery reads with larger revisions after recovery and a fresh creation', () => {
  const p = selected();
  p.accept(item('item/started', 'old-read', 'playground_state'));
  complete(p, 'recover', 'playground_edit', state({ status: 'recovered', revision: 0, scenes: 0 }), { arguments: { operation: 'recover' } });
  expect(p.accept(item('item/completed', 'old-read', 'playground_state', state({ revision: 5, scenes: 5 })))).toBeNull();
  p.accept(item('item/started', 'other-old', 'playground_state'));
  complete(p, 'recover-again', 'playground_edit', state({ status: 'recovered', revision: 0, scenes: 0 }), { arguments: { operation: 'recover' } });
  complete(p, 'fresh', 'playground_edit', state({ status: 'committed', revision: 1, scenes: 1 }));
  expect(p.accept(item('item/completed', 'other-old', 'playground_state', state({ revision: 5, scenes: 5, recoveryRequired: true })))).toBeNull();
});

it('still accepts a higher-revision edit completion after a newer pending read', () => {
  const p = selected();
  p.accept(item('item/started', 'edit'));
  complete(p, 'query', 'playground_state', state({ revision: 0, scenes: 0, pending: { stage: 'admitted' } }));
  expect(p.accept(item('item/completed', 'edit'))).toEqual({ status: 'stored', revision: 1, scenes: 1, recoveryRequired: false, operation: 'create' });
});

it('allows a bounded includeScene result but never reads or forwards private argument/structured content', () => {
  const p = selected(), value = state({ scene: { goal: 'private'.repeat(5000) } });
  const arguments_ = { operation: 'create', get scene() { throw Error('private argument accessed'); } };
  const result = { content: [{ type: 'text', text: JSON.stringify(value) }], get structuredContent() { throw Error('private structured content accessed'); } };
  expect(complete(p, 'query', 'playground_state', value, { arguments: arguments_, result }))
    .toEqual({ status: 'stored', revision: 1, scenes: 1, recoveryRequired: false });
});

it('does not carry a previous edit operation into a later state query or invalid edit', () => {
  const p = selected(); complete(p);
  expect(p.accept(item('item/started', 'query', 'playground_state'))).toEqual({ status: 'working', revision: 1, scenes: 1, recoveryRequired: false });
  p.accept(item('item/completed', 'query', 'playground_state', state()));
  expect(complete(p, 'invalid', 'playground_edit', state({ status: 'committed' }), { arguments: {} })).not.toHaveProperty('operation');
});

it('holds recovery across concurrent reads and publishes its reset before accepting fresh snapshots', () => {
  const p = selected(), recover = { arguments: { operation: 'recover' } };
  p.accept(item('item/started', 'recover', 'playground_edit', {}, recover));
  expect(p.accept(item('item/started', 'during', 'playground_state'))).toBeNull();
  expect(p.accept(item('item/completed', 'during', 'playground_state', state({ revision: 5, scenes: 5, recoveryRequired: true })))).toBeNull();
  p.accept(item('item/started', 'late-during', 'playground_state'));
  expect(p.accept(item('item/completed', 'recover', 'playground_edit', state({ status: 'recovered', revision: 0, scenes: 0 }), recover)))
    .toEqual({ status: 'recovered', revision: 0, scenes: 0, recoveryRequired: false, operation: 'recover' });
  expect(p.accept(item('item/completed', 'late-during', 'playground_state', state({ revision: 5, scenes: 5 })))).toBeNull();
  expect(complete(p, 'fresh-query', 'playground_state', state({ revision: 0, scenes: 0 })))
    .toEqual({ status: 'empty', revision: 0, scenes: 0, recoveryRequired: false });
});
