import { expect, it } from 'vitest';
import { Compiler } from '../src/core/compiler/compiler';
import { Scheduler } from '../src/core/runtime/scheduler';
it('expired definition drafts are rejected at admission and can be discarded without committing', () => {
  const c = new Compiler();
  const draft = c.prepareDefinition({ ...define, ttlMs: 1 }, 0);
  const s = new Scheduler({ now: () => 10 }, { apply() {}, dispose() {} }, { count() {} });
  s.cancel('e');
  expect(s.admit(draft)).toBe('expired');
  if (draft.kind === 'define') c.settleDefinition(draft.draft!, false);
  expect(c.sizes.macros).toBe(0);
});
const define = {
  v: 1,
  epoch: 'e',
  seq: 1,
  kind: 'define',
  body: { name: 'x', revision: 1, params: {}, body: { type: 'wait', durationMs: 1 } },
};
const call = {
  v: 1,
  epoch: 'e',
  seq: 2,
  kind: 'program',
  track: 'body',
  policy: 'replace',
  body: { type: 'call', name: 'x', revision: 1, args: {} },
};
it('definition is invisible until admission commit and rejection permits retry', () => {
  const c = new Compiler();
  const draft = c.prepareDefinition(define, 0);
  expect(draft.kind).toBe('define');
  if (draft.kind !== 'define') return;
  expect(() => c.compile(call, 0)).toThrow('unknown_macro');
  c.settleDefinition(draft.draft!, false);
  expect(c.sizes.macros).toBe(0);
  const retry = c.prepareDefinition(define, 0);
  if (retry.kind !== 'define') throw Error();
  c.settleDefinition(retry.draft!, true);
  expect(() => c.compile(call, 0)).not.toThrow();
});
it('pending definitions reserve names and are discarded on epoch changes without deleting committed session macros', () => {
  const c = new Compiler();
  const draft = c.prepareDefinition(define, 0);
  expect(() => c.prepareDefinition(define, 0)).toThrow('definition_pending');
  c.discardDefinitions();
  if (draft.kind === 'define') c.settleDefinition(draft.draft!, true);
  expect(c.sizes.macros).toBe(0);
  expect(() => c.prepareDefinition(define, 0)).not.toThrow();
});
