import { describe, it, expect } from 'vitest';
import { createExpressionStatus } from '../integrations/expression-status.mjs';

const session = { id: 'session', epoch: 'epoch' };
function fixture(options = {}) {
  let callbacks, time = 0, subscriptions = 0;
  const tracker = createExpressionStatus({ base: 'http://localhost', token: 'test', now: () => time,
    subscribe: async value => { callbacks = value; subscriptions++; return () => {}; }, ...options });
  return { tracker, feedback: (status, seq = 1) => callbacks.onFeedback({ session: 'session', epoch: 'epoch', seq, status }),
    lost: reason => callbacks.onLost(reason), advance: value => { time = value; }, count: () => subscriptions };
}
const receipt = { session: 'session', epoch: 'epoch', seq: 1, status: 'accepted' };
describe('bounded expression evidence', () => {
  it('closes permanently during pending subscription and drops the resolved stream', async () => {
    let resolve, stopped = 0, subscriptions = 0;
    const tracker = createExpressionStatus({ subscribe: () => { subscriptions++; return new Promise(done => { resolve = done; }); } });
    const pending = tracker.begin('own', session); tracker.close(); resolve(() => { stopped++; });
    await expect(pending).rejects.toThrow('expression_status_closed');
    await expect(tracker.begin('new', session)).rejects.toThrow('expression_status_closed');
    expect(stopped).toBe(1); expect(subscriptions).toBe(1);
  });

  it('captures feedback before ACK and keeps completed terminal despite late cancellation and duplicate ACK', async () => {
    const f = fixture(); await f.tracker.begin('own', session);
    f.feedback('applied'); f.feedback('accepted'); f.tracker.receipt('own', receipt);
    expect(f.tracker.read({ requestId: 'own' }).status).toBe('applied');
    f.feedback('completed'); f.feedback('cancelled'); f.tracker.receipt('own', receipt);
    expect(f.tracker.read({ requestId: 'own' })).toMatchObject({ status: 'completed', visibility: 'unknown' });
  });
  it('does not reconnect on reads or loss, nor turn gap into success', async () => {
    const f = fixture(); expect(f.tracker.read({ requestId: 'missing' }).status).toBe('unknown');
    expect(f.count()).toBe(0); await f.tracker.begin('own', session); f.tracker.receipt('own', receipt);
    f.lost('playground_sse_gap'); f.feedback('completed'); await f.tracker.begin('second', session);
    expect(f.count()).toBe(1); expect(f.tracker.read({ requestId: 'own' }).status).toBe('unknown');
  });
  it('evicts unmatched early feedback and refuses admitted request reuse across sessions', async () => {
    const f = fixture({ limit: 2 }); await f.tracker.begin('own', session);
    f.feedback('applied', 1); f.feedback('applied', 2); f.feedback('applied', 3);
    f.tracker.receipt('own', receipt);
    expect(f.tracker.read({ requestId: 'own' }).status).toBe('accepted');
    await expect(f.tracker.begin('own', { id: 'other' })).rejects.toThrow('request_id_session_reused');
    await f.tracker.begin('new', { id: 'other' });
    expect(f.tracker.read({ requestId: 'own' })).toMatchObject({ status: 'unknown', reason: 'session_changed' });
  });
  it('bounds entries and unmatched feedback, expires records and resets old session evidence', async () => {
    const f = fixture({ limit: 2, ttlMs: 10 });
    for (const id of ['a', 'b', 'c']) await f.tracker.begin(id, session);
    expect(f.tracker.read({ requestId: 'a' }).reason).toBe('not_retained');
    f.tracker.receipt('b', receipt); f.tracker.reset('cancel_acknowledged');
    f.feedback('completed');
    expect(f.tracker.read({ requestId: 'b' }).reason).toBe('cancel_acknowledged');
    f.advance(10); expect(f.tracker.read({ requestId: 'b' }).reason).toBe('not_retained');
  });
});
