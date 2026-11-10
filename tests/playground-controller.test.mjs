import { expect, it } from 'vitest';
import { createPlaygroundController } from '../integrations/playground-controller.mjs';

const epoch = '12345678-1234-4234-8234-123456789abc', nextEpoch = '87654321-4321-4321-8321-cba987654321';
const scene = (x = 0) => ({ parts: [{ id: 'free-form', kind: 'ellipsoid', center: [x, 0, 0], scale: [0.2, 0.3, 0.1] }],
  style: { color: '#123456', brightness: 0.8, pointSize: 1.2, dispersion: x }, flow: { field: 'pulse', strength: 0.1 }, goal: 'private optional goal' });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(options = {}) {
  let session = { id: 's', epoch }, seq = 0, source, stops = 0, subscriptions = 0;
  const sent = [], invalidated = [];
  const controller = createPlaygroundController({ currentSession: async () => session,
    subscribe: async (_session, feedback, lost) => { subscriptions++; source = { feedback, lost }; return () => stops++; },
    send: async (args, boundSession) => { const receipt = { session: session.id, epoch: session.epoch, seq: ++seq, status: 'accepted' }; sent.push({ args, receipt, boundSession }); return receipt; },
    invalidate: async before => { invalidated.push(before); session = { ...session, epoch: nextEpoch }; return session; }, timeoutMs: 1000, ...options });
  const feedback = (receipt, status) => source.feedback({ ...receipt, status });
  const complete = () => { for (const { receipt } of sent.slice(-2)) for (const status of ['applied', 'completed']) feedback(receipt, status); };
  return { controller, sent, feedback, complete, invalidated, lost: () => source.lost('gap'), get source() { return source; },
    get stops() { return stops; }, get subscriptions() { return subscriptions; }, replace: value => { session = value; } };
}

it('subscribes before ordered sends, strips phase, commits only completed work, and redacts default reads', async () => {
  const f = fixture(), job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect(f.subscriptions).toBe(1); expect(f.sent).toHaveLength(2);
  expect(f.sent.map(value => value.args.kind)).toEqual(['program', 'state']);
  expect(f.sent.every(value => !Object.hasOwn(value.args, 'phase'))).toBe(true);
  expect(f.sent[0].args.requestId).not.toBe(f.sent[1].args.requestId);
  expect(f.sent.every(value => value.boundSession.id === 's' && value.boundSession.epoch === epoch)).toBe(true);
  await expect(f.controller.begin({ operation: 'reset', expectedRevision: 0 })).rejects.toThrow('playground_busy');
  expect((await f.controller.read()).revision).toBe(0);
  for (const { receipt } of f.sent) f.feedback(receipt, 'applied');
  expect((await f.controller.read()).revision).toBe(0);
  f.complete(); expect(await job.result).toMatchObject({ status: 'committed', revision: 1 });
  expect(JSON.stringify(await f.controller.read())).not.toContain('private optional goal');
  await expect(f.controller.read('true')).rejects.toThrow('playground_arguments');
  expect((await f.controller.read(true)).scene).toEqual(scene()); f.controller.close();
});

it('reuses a healthy stream for remix/undo and restores private in-session snapshots', async () => {
  const f = fixture();
  for (const args of [{ operation: 'create', scene: scene() }, { operation: 'remix', scene: scene(0.2) }, { operation: 'undo' }]) {
    const before = await f.controller.read(), job = await f.controller.begin({ ...args, expectedRevision: before.revision });
    f.complete(); expect((await job.result).status).toBe('committed');
    f.controller.interrupt('ordinary_expression'); expect((await f.controller.read()).recoveryRequired).toBe(false);
  }
  expect(f.subscriptions).toBe(1); expect((await f.controller.read(true)).scene).toEqual(scene()); f.controller.close();
});

it('buffers authenticated events arriving before their ACKs', async () => {
  let feedback, seq = 0;
  const f = fixture({ subscribe: async (_session, cb) => { feedback = cb; return () => {}; }, send: async () => {
    const receipt = { session: 's', epoch, seq: ++seq, status: 'accepted' };
    for (const status of ['applied', 'completed']) feedback({ ...receipt, status }); return receipt;
  } });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect(await job.result).toMatchObject({ status: 'committed', revision: 1 }); f.controller.close();
});

it('latches gap and user interruption, requiring explicit changed-epoch recovery', async () => {
  const f = fixture(), job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  f.feedback(f.sent[0].receipt, 'applied'); f.lost(); f.complete();
  expect(await job.result).toMatchObject({ status: 'uncertain', recoveryRequired: true });
  await expect(f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() })).rejects.toThrow('playground_recovery_required');
  const recovery = await f.controller.begin({ operation: 'recover', expectedRevision: 0 });
  expect(await recovery.result).toMatchObject({ status: 'recovered', revision: 0, scenes: 0 });
  expect(f.invalidated).toEqual([{ id: 's', epoch }]);
  const next = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene(0.1) });
  f.controller.interrupt('user_interrupt'); f.complete(); expect((await next.result).status).toBe('uncertain');
  expect((await f.controller.read()).revision).toBe(0); f.controller.close();
});

it('times out a hung send, releases begin, and never starts baseline after a late ACK', async () => {
  let resolve, sends = 0;
  const f = fixture({ timeoutMs: 15, send: () => { sends++; return new Promise(done => { resolve = done; }); } });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect(await job.result).toMatchObject({ status: 'uncertain', code: 'playground_timeout' });
  resolve({ session: 's', epoch, seq: 1, status: 'accepted' }); await tick();
  expect(sends).toBe(1); expect((await f.controller.read()).revision).toBe(0); f.controller.close();
});

it('detects session replacement, idle stream loss, invalid recovery and input/CAS violations', async () => {
  const f = fixture({ invalidate: async () => ({ id: 's', epoch }) });
  await expect(f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene(), extra: 1 })).rejects.toThrow();
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() }); f.complete(); await job.result;
  await expect(f.controller.begin({ operation: 'undo', expectedRevision: 0 })).rejects.toThrow('playground_revision');
  f.lost(); expect((await f.controller.read()).recoveryRequired).toBe(true);
  const failed = await f.controller.begin({ operation: 'recover', expectedRevision: 1 });
  expect((await failed.result).status).toBe('uncertain');
  f.replace({ id: 'new', epoch: nextEpoch }); expect((await f.controller.read(true)).scene).toBeNull(); f.controller.close();
});

it('bounds early feedback and ignores foreign source tuples without exposing error payloads', async () => {
  let feedback, sends = 0;
  const f = fixture({ subscribe: async (_session, cb) => { feedback = cb; return () => {}; }, send: async () => {
    sends++;
    for (let seq = 1; seq <= 70; seq++) feedback({ session: 's', epoch, seq, status: 'completed', private: 'not retained' });
    return { session: 's', epoch, seq: 1, status: 'accepted' };
  } });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect(await job.result).toMatchObject({ status: 'uncertain', code: 'playground_feedback_overflow' });
  expect(sends).toBe(1); expect(JSON.stringify(await f.controller.read())).not.toContain('not retained'); f.controller.close();
  const other = fixture(), next = await other.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  for (let seq = 0; seq < 100; seq++) other.feedback({ session: 'foreign', epoch: nextEpoch, seq }, 'completed');
  other.complete(); expect((await next.result).status).toBe('committed'); other.controller.close();
});

it('bounds hung subscription and recovery, closing late subscriptions without sending or resurrection', async () => {
  let subscribed, stops = 0, sends = 0;
  const f = fixture({ timeoutMs: 15, subscribe: () => new Promise(resolve => { subscribed = resolve; }), send: async () => { sends++; } });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect((await job.result).status).toBe('uncertain'); subscribed(() => stops++); await tick();
  expect(stops).toBe(1); expect(sends).toBe(0); f.controller.close();
  let invalidate;
  const other = fixture({ timeoutMs: 15, invalidate: () => new Promise(resolve => { invalidate = resolve; }) });
  const recover = await other.controller.begin({ operation: 'recover', expectedRevision: 0 });
  expect((await recover.result).status).toBe('uncertain');
  invalidate({ id: 's', epoch: nextEpoch }); await tick();
  expect((await other.controller.read()).recoveryRequired).toBe(true); other.controller.close();
});

it('treats cancellation and transport errors as sticky uncertainty while closed work cannot resume', async () => {
  const f = fixture(), job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  f.feedback(f.sent[0].receipt, 'applied'); f.feedback(f.sent[0].receipt, 'cancelled'); f.complete();
  expect((await job.result).status).toBe('uncertain'); expect((await f.controller.read()).revision).toBe(0); f.controller.close();
  const other = fixture({ send: async () => { throw Error('private credential payload'); } });
  const failed = await other.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect(JSON.stringify(await failed.result)).not.toContain('private credential');
  other.controller.close(); await expect(other.controller.begin({ operation: 'recover', expectedRevision: 0 })).rejects.toThrow('playground_closed');
});

it('checks monotonic deadline before baseline even when the timer callback was delayed', async () => {
  let sends = 0;
  const f = fixture({ timeoutMs: 15, send: async () => {
    sends++; const until = performance.now() + 25; while (performance.now() < until) {}
    return { session: 's', epoch, seq: 1, status: 'accepted' };
  } });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect(await job.result).toMatchObject({ status: 'uncertain', code: 'playground_timeout' });
  expect(sends).toBe(1); f.controller.close();
});

it('returns cloned interrupted owners and preserves owner A across current-session B before recovery', async () => {
  const pending = fixture(), job = await pending.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  const owner = pending.controller.interrupt(); expect(owner).toEqual({ id: 's', epoch });
  owner.id = 'mutated'; expect(pending.controller.interrupt()).toEqual({ id: 's', epoch });
  expect((await job.result).status).toBe('uncertain'); pending.controller.close();
  let sends = 0;
  const f = fixture({ send: async () => { sends++; throw Error('transport lost'); } });
  const timed = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() }); await timed.result;
  f.replace({ id: 'B', epoch: nextEpoch }); expect((await f.controller.read(true)).scene).toBeNull();
  expect(f.controller.interrupt()).toEqual({ id: 's', epoch });
  const recovery = await f.controller.begin({ operation: 'recover', expectedRevision: 0 });
  expect(await recovery.result).toMatchObject({ status: 'recovered', scenes: 0, recoveryRequired: false });
  expect(f.invalidated).toEqual([{ id: 's', epoch }]); expect(sends).toBe(1);
  expect(f.controller.interrupt()).toBeUndefined(); f.controller.close();
});

it('accepts pending admission only through exact SSE acceptance, then requires both phases to finish', async () => {
  let feedback; const posted = [];
  const f = fixture({ timeoutMs: 1000, subscribe: async (_session, cb) => { feedback = cb; return () => {}; }, send: async () => {
    const receipt = { session: 's', epoch, seq: posted.length + 1, status: 'pending' }; posted.push(receipt); return receipt;
  } });
  const beginning = f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() }); await tick();
  expect(posted).toHaveLength(1);
  feedback({ ...posted[0], status: 'accepted', seq: 99 }); await tick(); expect(posted).toHaveLength(1);
  feedback({ ...posted[0], status: 'accepted' }); await tick(); expect(posted).toHaveLength(2);
  feedback({ ...posted[1], status: 'accepted' }); const job = await beginning;
  expect((await f.controller.read()).revision).toBe(0);
  for (const status of ['applied', 'completed']) feedback({ ...posted[0], status });
  expect((await f.controller.read()).revision).toBe(0);
  for (const status of ['applied', 'completed']) feedback({ ...posted[1], status });
  expect(await job.result).toMatchObject({ status: 'committed', revision: 1 }); expect(posted).toHaveLength(2); f.controller.close();
});

it('buffers early accepted metadata before a pending HTTP response without resending', async () => {
  let feedback, sends = 0;
  const f = fixture({ subscribe: async (_session, cb) => { feedback = cb; return () => {}; }, send: async () => {
    const receipt = { session: 's', epoch, seq: ++sends, status: 'pending' };
    for (const status of ['accepted', 'applied', 'completed']) feedback({ ...receipt, status }); return receipt;
  } });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect((await job.result).status).toBe('committed'); expect(sends).toBe(2); f.controller.close();
});

it('never sends baseline when pending admission lacks acceptance and reports typed rejection safely', async () => {
  let sends = 0;
  const f = fixture({ timeoutMs: 100, send: async () => ({ session: 's', epoch, seq: ++sends, status: 'pending' }) });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect(await job.result).toMatchObject({ status: 'uncertain', code: 'playground_admission_pending', revision: 0 });
  expect(sends).toBe(1); f.controller.close();
  const other = fixture({ send: async () => ({ status: 'rejected', code: 'private raw error' }) });
  const rejected = await other.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect(await rejected.result).toMatchObject({ status: 'uncertain', code: 'playground_admission_rejected' });
  expect(JSON.stringify(await rejected.result)).not.toContain('private raw error'); other.controller.close();
});

it('uses exactly correlated SSE admission when the body HTTP reply is held; both phases still must complete', async () => {
  let reject, serial = 0; const sent = [];
  const f = fixture({ send: (args, owner) => {
    const receipt = { ...owner, session: owner.id, seq: ++serial, status: 'accepted', requestId: args.requestId };
    sent.push(receipt); f.source.feedback(receipt);
    if (serial === 1) return new Promise((_resolve, fail) => { reject = fail; });
    return Promise.resolve(receipt);
  } });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect(sent).toHaveLength(2); expect((await f.controller.read()).revision).toBe(0);
  for (const receipt of sent) for (const status of ['applied', 'completed']) f.feedback(receipt, status);
  expect(await job.result).toMatchObject({ status: 'committed', revision: 1 });
  reject(Error('late HTTP disconnect')); await tick(); expect(sent).toHaveLength(2);
  expect((await f.controller.read()).recoveryRequired).toBe(false); f.controller.close();
});
it('ignores foreign correlation while HTTP is unresolved and does not dispatch baseline after timeout', async () => {
  let sent = 0;
  const f = fixture({ timeoutMs: 100, send: (args, owner) => {
    sent++; f.source.feedback({ session: owner.id, epoch: owner.epoch, seq: 1, status: 'accepted', requestId: args.requestId + '-foreign' });
    return new Promise(() => {});
  } });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  expect(await job.result).toMatchObject({ status: 'uncertain', code: 'playground_timeout', revision: 0, waitingFor: 'body_http_or_correlated_ack' });
  expect(sent).toBe(1); f.controller.close();
});
it('scopes a contradictory late HTTP receipt to its still-active transaction', async () => {
  let release, serial = 0;
  const f = fixture({ send: (args, owner) => {
    const receipt = { session: owner.id, epoch: owner.epoch, seq: ++serial, status: 'accepted', requestId: args.requestId };
    f.source.feedback(receipt);
    return serial === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(receipt);
  } });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  release({ session: 's', epoch, seq: 999, status: 'accepted' });
  expect(await job.result).toMatchObject({ status: 'uncertain', code: 'playground_receipt_conflict', recoveryRequired: true });
  f.controller.close();
});

it('treats a late explicit HTTP rejection as a conflict while preserving canonical transport-error success', async () => {
  let reject, serial = 0;
  const f = fixture({ send: (args, owner) => {
    const receipt = { session: owner.id, epoch: owner.epoch, seq: ++serial, status: 'accepted', requestId: args.requestId };
    f.source.feedback(receipt);
    return serial === 1 ? new Promise((_resolve, fail) => { reject = fail; }) : Promise.resolve(receipt);
  } });
  const job = await f.controller.begin({ operation: 'create', expectedRevision: 0, scene: scene() });
  reject(Object.assign(Error('HTTP rejection'), { receipt: { status: 'rejected' } }));
  expect(await job.result).toMatchObject({ status: 'uncertain', code: 'playground_receipt_conflict' });
  f.controller.close();
});
