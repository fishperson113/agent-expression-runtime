import { afterEach, expect, it, vi } from 'vitest';
import { createExpressionStatus } from '../integrations/expression-status.mjs';
import { withComposeLifecycle } from '../integrations/compose-receipt.mjs';
const owner = { id: 'session', epoch: 'epoch' };
const receipt = { session: 'session', epoch: 'epoch', seq: 1, requestId: 'own', status: 'accepted' };
const response = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
afterEach(() => vi.useRealTimers());
async function fixture() {
  let callbacks;
  const tracker = createExpressionStatus({ subscribe: async value => { callbacks = value; return () => {}; } });
  await tracker.begin('own', owner); tracker.receipt('own', receipt);
  return { tracker, feedback: status => callbacks.onFeedback({ ...receipt, status }), lost: reason => callbacks.onLost(reason) };
}
it('waits for real completion without changing admission or claiming visibility', async () => {
  vi.useFakeTimers(); const f = await fixture(), original = response(receipt);
  let returned = false; const pending = withComposeLifecycle(Promise.resolve(original), f.tracker).then(x => { returned = true; return x; });
  await Promise.resolve(); await vi.advanceTimersByTimeAsync(400); f.feedback('applied');
  expect(returned).toBe(false); await vi.advanceTimersByTimeAsync(150); f.feedback('completed');
  const value = JSON.parse((await pending).content[0].text);
  expect(value).toMatchObject({ ...receipt, lifecycle: { status: 'completed', visibility: 'unknown' } });
  expect(original).toEqual(response(receipt)); expect(vi.getTimerCount()).toBe(0);
});
it('bounds timeout at 800ms and never promotes applied evidence', async () => {
  vi.useFakeTimers(); const f = await fixture(); f.feedback('applied');
  let settled = false; const pending = f.tracker.wait({ requestId: 'own' }, 99999).then(x => { settled = true; return x; });
  await vi.advanceTimersByTimeAsync(799); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(await pending).toMatchObject({ status: 'applied', visibility: 'unknown' });
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['loss', 'reset', 'close', 'cancelled', 'failed'])('settles immediately and truthfully on %s', async kind => {
  vi.useFakeTimers(); const f = await fixture(), pending = f.tracker.wait({ requestId: 'own' });
  if (kind === 'loss') f.lost('stream_lost');
  if (kind === 'reset') f.tracker.reset('cancel_acknowledged');
  if (kind === 'close') f.tracker.close();
  if (kind === 'cancelled') f.feedback('cancelled');
  if (kind === 'failed') f.tracker.failed('own');
  expect(await pending).toMatchObject({ status: kind === 'cancelled' ? 'cancelled' : 'unknown', visibility: 'unknown' });
  expect(vi.getTimerCount()).toBe(0);
});
it('allows only one waiter, so another compose cannot reserve another mailbox slot', async () => {
  vi.useFakeTimers(); const f = await fixture();
  const pending = f.tracker.wait({ requestId: 'own' });
  await f.tracker.begin('second', owner); f.tracker.receipt('second', { ...receipt, seq: 2 });
  expect(await f.tracker.wait({ requestId: 'second' })).toMatchObject({ status: 'accepted' });
  expect(vi.getTimerCount()).toBe(1); f.feedback('completed'); await pending;
  expect(vi.getTimerCount()).toBe(0);
});
it('does not wait on absent, disconnected or already terminal evidence', async () => {
  vi.useFakeTimers(); const f = await fixture();
  expect((await f.tracker.wait({ requestId: 'missing' })).status).toBe('unknown');
  f.feedback('completed'); expect((await f.tracker.wait({ requestId: 'own' })).status).toBe('completed');
  f.lost('lost'); await f.tracker.begin('next', owner); f.tracker.receipt('next', { ...receipt, seq: 2 });
  expect((await f.tracker.wait({ requestId: 'next' })).status).toBe('unknown');
  expect(vi.getTimerCount()).toBe(0);
});
it('only enriches a successful single receipt after its mutation promise resolves', async () => {
  let resolve; const mutation = new Promise(done => { resolve = done; });
  const tracker = { wait: vi.fn(async () => ({ status: 'completed', visibility: 'unknown' })) };
  const pending = withComposeLifecycle(mutation, tracker); await Promise.resolve(); expect(tracker.wait).not.toHaveBeenCalled();
  resolve(response(receipt)); await pending; expect(tracker.wait).toHaveBeenCalledOnce();
  tracker.wait.mockClear();
  for (const original of [{ ...response(receipt), isError: true }, response({ status: 'rejected' }), response({ status: 'accepted' }),
    { content: [{ type: 'text', text: 'bad JSON' }] }, { content: [response(receipt).content[0], response({ status: 'uncertain' }).content[0]] }])
    expect(await withComposeLifecycle(Promise.resolve(original), tracker)).toBe(original);
  expect(tracker.wait).not.toHaveBeenCalled();
});

it.each(['session','epoch','seq','requestId'])('never attaches foreign lifecycle evidence for changed %s',async field=>{
 const observed={requestId:'own',status:'completed',receipt:{...receipt},visibility:'unknown'};
 if(field==='requestId')observed.requestId='foreign';else observed.receipt[field]=field==='seq'?99:'foreign';
 const result=await withComposeLifecycle(Promise.resolve(response(receipt)),{wait:async()=>observed});
 expect(JSON.parse(result.content[0].text)).toMatchObject({status:'accepted',lifecycle:{status:'unknown',reason:'receipt_identity_unverified',visibility:'unknown'}});
});
it('does not upgrade cancelled evidence from a late completed frame',async()=>{
 vi.useFakeTimers();const f=await fixture(),pending=withComposeLifecycle(Promise.resolve(response(receipt)),f.tracker);
 await Promise.resolve();f.feedback('cancelled');f.feedback('completed');
 expect(JSON.parse((await pending).content[0].text).lifecycle.status).toBe('cancelled');expect(vi.getTimerCount()).toBe(0);
});

it.each(['rejected','session-reset'])('retains %s instead of late completion during wait',async kind=>{
 vi.useFakeTimers();const f=await fixture(),pending=withComposeLifecycle(Promise.resolve(response(receipt)),f.tracker);
 await Promise.resolve();
 if(kind==='rejected')f.feedback('rejected');else f.tracker.reset('session_changed');
 f.feedback('completed');const value=JSON.parse((await pending).content[0].text);
 expect(value.status).toBe('accepted');expect(value.lifecycle.status).toBe(kind==='rejected'?'rejected':'unknown');
 expect(value.lifecycle.visibility).toBe('unknown');expect(vi.getTimerCount()).toBe(0);
});
