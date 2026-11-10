// Node-only negative controls: no browser, model, media or provider.
import assert from 'node:assert/strict';
import { awaitResearchReady, closeResearchRoute } from './startup-contract.mjs';

const never = new Promise(() => {});
await assert.rejects(awaitResearchReady(never, Promise.reject(Error('PUBLIC_SETUP_FAILURE')), 1000), /research_host_setup_failed/);
await assert.rejects(awaitResearchReady(never, Promise.resolve(1), 1000), /research_host_ended_before_ready/);
await assert.rejects(awaitResearchReady(never, never, 5), /research_ready_timeout/);
assert.deepEqual(await awaitResearchReady(Promise.resolve({ publicReady: true }), never), { publicReady: true });
let aborted = 0, ended = 0;
const abort = { abort() { aborted++; throw Error('PUBLIC_CLOSE_FAILURE'); } };
const child = { stdin: { end() { ended++; } } };
await assert.rejects(closeResearchRoute(abort, child, Promise.resolve()), /live_cleanup_failed/);
assert.equal(aborted, 1); assert.equal(ended, 1);
await closeResearchRoute(abort, child, Promise.reject(Error('PUBLIC_SECONDARY_FAILURE')), true);
assert.equal(aborted, 2); assert.equal(ended, 2);
console.log(JSON.stringify({ setupFailure: 'observed immediately', readinessTimeout: 'bounded',
  readyTimerCleared: true, cleanupAllAttempted: true, cleanupFailurePropagated: true,
  primaryErrorKeepsPrecedence: true, browserCalls: 0, realModelCalls: 0 }));
