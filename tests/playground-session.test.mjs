import { expect, it } from 'vitest';
import { PlaygroundSession } from '../integrations/playground-session.mjs';
import { LiveCompiler } from '../src/core/live/compiler';

const epoch = '12345678-1234-4234-8234-123456789abc';
const scene = (x = 0) => ({ parts: [{ id: 'arbitrary-part', kind: 'ellipsoid', center: [x, 0, 0], scale: [0.2, 0.3, 0.1], rotation: [0, 0, 0], weight: 1, motion: null }],
  style: { color: '#123456', pointSize: 1.2 + x, brightness: 0.8, dispersion: x }, flow: { field: 'pulse', strength: x }, goal: 'Try my own variation' });
const propose = (journal, operation, value) => journal.propose({ sessionId: 's', expectedRevision: journal.status().revision, operation, scene: value });
function apply(journal, proposal, seq = 1) {
  for (const [i, phase] of ['body', 'baseline'].entries()) {
    journal.admit(proposal.transaction, phase, { session: 's', status: 'accepted', epoch, seq: seq * 2 + i });
    expect(journal.feedback({ session: 's', status: 'applied', epoch, seq: seq * 2 + i })).toBe(true);
    expect(journal.feedback({ session: 's', status: 'completed', epoch, seq: seq * 2 + i })).toBe(true);
  }
}

it('requires both authenticated applied phases and keeps partial outcomes locked', () => {
  const journal = new PlaygroundSession('s'), first = propose(journal, 'create', scene());
  expect(first.commands.map(command => command.phase)).toEqual(['body', 'baseline']);
  for (const status of ['accepted', 'pending', 'rejected'])
    expect(() => journal.admit(first.transaction, 'body', { session: 'foreign', status, epoch, seq: 1 })).toThrow('playground_receipt');
  journal.admit(first.transaction, 'body', { session: 's', status: 'pending' });
  expect(journal.feedback({ session: 's', status: 'applied', epoch, seq: 1 })).toBe(false);
  journal.admit(first.transaction, 'body', { session: 's', status: 'accepted', epoch, seq: 1 });
  journal.admit(first.transaction, 'body', { session: 's', status: 'pending' });
  expect(journal.status().pending.stage).toBe('admitted');
  expect(journal.feedback({ session: 'foreign', status: 'applied', epoch, seq: 1 })).toBe(false);
  expect(journal.feedback({ session: 's', status: 'applied', epoch: 'old', seq: 1 })).toBe(false);
  journal.feedback({ session: 's', status: 'applied', epoch, seq: 1 });
  expect(journal.status().revision).toBe(0);
  journal.admit(first.transaction, 'baseline', { session: 's', status: 'accepted', epoch, seq: 2 });
  journal.feedback({ session: 's', status: 'applied', epoch, seq: 2 });
  expect(journal.status().revision).toBe(0);
  journal.feedback({ session: 's', status: 'completed', epoch, seq: 1 });
  expect(journal.status().revision).toBe(0);
  journal.feedback({ session: 's', status: 'completed', epoch, seq: 2 });
  expect(journal.status()).toMatchObject({ revision: 1, scenes: 1, pending: null });
  const next = propose(journal, 'remix', scene(0.2));
  journal.admit(next.transaction, 'body', { session: 's', status: 'accepted', epoch, seq: 3 });
  journal.admit(next.transaction, 'baseline', { status: 'rejected' });
  expect(journal.status().pending.stage).toBe('desynchronized');
  expect(() => propose(journal, 'reset')).toThrow('playground_busy');
  journal.feedback({ session: 's', status: 'applied', epoch, seq: 3 });
  expect(journal.current()).toEqual(scene());
});

it('undo/reset select full snapshots while cancellation never claims rollback', () => {
  const journal = new PlaygroundSession('s'); apply(journal, propose(journal, 'create', scene()), 1);
  apply(journal, propose(journal, 'remix', scene(0.2)), 2);
  const undo = propose(journal, 'undo');
  expect(undo.commands[0].body.program.children[1]).toMatchObject({ type: 'style', ...scene().style });
  expect(undo.commands[1].body).toMatchObject({ brightness: 0.8, pointSize: 1.2, dispersion: 0 });
  apply(journal, undo, 3); expect(journal.current()).toEqual(scene());
  apply(journal, propose(journal, 'remix', scene(0.3)), 4);
  apply(journal, propose(journal, 'reset'), 5);
  expect(journal.current()).toEqual(scene()); expect(journal.status().scenes).toBe(1);
  expect(journal.feedback({ session: 's', status: 'cancelled', epoch, seq: 11 })).toBe(false);
  const pending = propose(journal, 'remix', scene(0.1));
  journal.admit(pending.transaction, 'body', { session: 's', status: 'accepted', epoch, seq: 12 });
  journal.feedback({ session: 's', status: 'cancelled', epoch, seq: 12 });
  expect(journal.status().pending.stage).toBe('desynchronized'); expect(journal.current()).toEqual(scene());
});

it('rejects stale owners and malformed input atomically; clones all external state', () => {
  const journal = new PlaygroundSession('s'), input = scene();
  for (const patch of [{ sessionId: 'other' }, { expectedRevision: 2 }, { scene: { ...input, code: 'private' } }, { scene: scene(NaN) }])
    expect(() => journal.propose({ sessionId: 's', expectedRevision: 0, operation: 'create', scene: input, ...patch })).toThrow();
  expect(journal.status().pending).toBeNull();
  const first = propose(journal, 'create', input); input.parts[0].center[0] = 1;
  first.commands[0].body.program.children[0].parts[0].center[0] = 1;
  journal.admit(first.transaction, 'body', { session: 's', status: 'accepted', epoch, seq: 1 });
  journal.feedback({ session: 's', status: 'applied', epoch, seq: 1 });
  journal.admit(first.transaction, 'baseline', { session: 's', status: 'accepted', epoch, seq: 2 });
  journal.feedback({ session: 's', status: 'applied', epoch, seq: 2 });
  for (const seq of [1, 2]) journal.feedback({ session: 's', status: 'completed', epoch, seq });
  const output = journal.current(); output.parts[0].center[0] = 1;
  expect(journal.current().parts[0].center[0]).toBe(0);
  expect(JSON.stringify(journal.status())).not.toContain('Try my own variation');
  const remix = propose(journal, 'remix', scene(0.1)); journal.admit(remix.transaction, 'body', { status: 'rejected' });
  expect(journal.status().revision).toBe(1);
});

it('bounds session history, pending memory and scene size, then disposes private state', () => {
  const journal = new PlaygroundSession('s'); apply(journal, propose(journal, 'create', scene()), 1);
  for (let i = 2; i <= 100; i++) apply(journal, propose(journal, 'remix', scene(i / 100)), i);
  expect(journal.status().scenes).toBe(12);
  expect(journal.status().bytes).toBeLessThanOrEqual(131072);
  apply(journal, propose(journal, 'reset'), 101); expect(journal.current()).toEqual(scene());
  const huge = scene(); huge.goal = 'x'.repeat(33000);
  expect(() => propose(journal, 'remix', huge)).toThrow('playground_scene_bytes');
  expect(() => propose(journal, 'remix', { ...scene(), goal: 'x'.repeat(161) })).toThrow('playground_goal');
  journal.dispose(); expect(journal.current()).toBeNull();
  expect(() => propose(journal, 'remix', scene())).toThrow('playground_closed');
});

it('emits a real compilable transient preview with explicit coarse posture and color', () => {
  const journal = new PlaygroundSession('s'), proposal = propose(journal, 'create', scene());
  const result = new LiveCompiler().compile({ v: 1, epoch, seq: 1, kind: 'program', track: 'body', policy: 'replace', body: proposal.commands[0].body }, 0);
  expect(result.configuration.controls).toEqual([]);
  expect(proposal.commands[0].body.program.children[1]).toMatchObject({ color: '#123456' });
  expect(proposal.commands[0].body.program.children[3]).toMatchObject({ rise: 0, advance: 0, grow: 1, spread: 1, path: 'spoke', effort: { flow: 0 } });
});

it('enforces the aggregate byte limit without replacing a committed scene', () => {
  const journal = new PlaygroundSession('s'), large = scene();
  large.parts = Array.from({ length: 24 }, (_, i) => ({ id: 'p' + i, kind: 'curve', radius: 0.02,
    points: Array.from({ length: 12 }, (_, j) => [0.1234567890123456 + j / 100, 0.3456789012345678, 0.567890123456789]) }));
  apply(journal, propose(journal, 'create', large), 1);
  let rejected = false;
  for (let seq = 2; seq < 20; seq++) {
    const before = journal.status();
    try { apply(journal, propose(journal, 'remix', large), seq); }
    catch (error) { expect(error.message).toBe('playground_memory'); expect(journal.status()).toEqual(before); rejected = true; break; }
  }
  expect(rejected).toBe(true); expect(journal.status().bytes).toBeLessThanOrEqual(131072);
});

it('refuses local/backward/reused receipts and freezes uncertain plans even after late evidence', () => {
  const journal = new PlaygroundSession('s'), first = propose(journal, 'create', scene());
  expect(() => journal.admit(first.transaction, 'body', { session: 's', status: 'accepted', epoch: 'local', seq: 1 })).toThrow('playground_receipt');
  apply(journal, first, 10);
  const next = propose(journal, 'remix', scene(0.1));
  expect(() => journal.admit(next.transaction, 'body', { session: 's', status: 'accepted', epoch, seq: 9 })).toThrow('playground_receipt');
  journal.admit(next.transaction, 'body', { session: 's', status: 'accepted', epoch, seq: 22 });
  expect(() => journal.admit(next.transaction, 'baseline', { session: 's', status: 'accepted', epoch, seq: 22 })).toThrow('playground_receipt');
  journal.uncertain(next.transaction);
  journal.admit(next.transaction, 'baseline', { session: 's', status: 'accepted', epoch, seq: 23 });
  for (const seq of [22, 23]) journal.feedback({ session: 's', epoch, seq, status: 'applied' });
  for (const seq of [22, 23]) journal.feedback({ session: 's', epoch, seq, status: 'completed' });
  expect(journal.status()).toMatchObject({ revision: 1, pending: { stage: 'desynchronized' } });
  expect(() => propose(journal, 'reset')).toThrow('playground_busy'); journal.dispose();
});

it('keeps optional goal changes inert and rejects duplicate part identities', () => {
  const first = new PlaygroundSession('a'), second = new PlaygroundSession('b');
  const absent = scene(); delete absent.goal;
  const a = first.propose({ sessionId: 'a', expectedRevision: 0, operation: 'create', scene: absent });
  const b = second.propose({ sessionId: 'b', expectedRevision: 0, operation: 'create', scene: scene() });
  expect(a.commands).toEqual(b.commands);
  const duplicate = scene(); duplicate.parts.push(structuredClone(duplicate.parts[0]));
  expect(() => propose(new PlaygroundSession('s'), 'create', duplicate)).toThrow('playground_scene');
});

it('latches cancellation after body application despite later baseline application', () => {
  const journal = new PlaygroundSession('s'), first = propose(journal, 'create', scene());
  journal.admit(first.transaction, 'body', { session: 's', status: 'accepted', epoch, seq: 1 });
  journal.admit(first.transaction, 'baseline', { session: 's', status: 'accepted', epoch, seq: 2 });
  for (const [status, seq] of [['applied', 1], ['cancelled', 1], ['applied', 2]])
    journal.feedback({ session: 's', epoch, seq, status });
  expect(journal.status()).toMatchObject({ revision: 0, scenes: 0, pending: { stage: 'desynchronized' } });
  expect(() => propose(journal, 'create', scene())).toThrow('playground_busy');
});

it('cannot unlock pre-receipt uncertainty through late pending, ACK, completion or rejection', () => {
  const journal = new PlaygroundSession('s'), first = propose(journal, 'create', scene());
  journal.uncertain(first.transaction);
  journal.admit(first.transaction, 'body', { session: 's', status: 'pending' });
  apply(journal, first);
  journal.admit(first.transaction, 'body', { status: 'rejected' }, true);
  expect(journal.status()).toMatchObject({ revision: 0, pending: { stage: 'desynchronized' } });
  expect(() => propose(journal, 'create', scene())).toThrow('playground_busy');
});

it('requires ordered phases and prior application even when completion is reported', () => {
  const unordered = new PlaygroundSession('s'), wrong = propose(unordered, 'create', scene());
  expect(() => unordered.admit(wrong.transaction, 'baseline', { session: 's', status: 'pending' })).toThrow('playground_order');
  const journal = new PlaygroundSession('s'), first = propose(journal, 'create', scene());
  journal.admit(first.transaction, 'body', { session: 's', status: 'accepted', epoch, seq: 1 });
  expect(journal.feedback({ session: 's', status: 'completed', epoch, seq: 1 })).toBe(false);
  journal.admit(first.transaction, 'baseline', { session: 's', status: 'accepted', epoch, seq: 2 });
  for (const seq of [1, 2]) for (const status of ['applied', 'completed']) journal.feedback({ session: 's', epoch, seq, status });
  expect(journal.status().revision).toBe(0);
  const clean = new PlaygroundSession('s'), rejected = propose(clean, 'create', scene());
  clean.admit(rejected.transaction, 'body', { status: 'rejected' }, true);
  expect(clean.status().pending).toBeNull();
});
