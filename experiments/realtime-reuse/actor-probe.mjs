// Optional research harness. No model, media, account credentials or hidden thread.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { createActor, setup, fromPromise, assign } from 'xstate';
import { LiveOutput } from '../../integrations/live-output.mjs';
import { LiveConversation } from '../../integrations/live-conversation.mjs';
import { LiveReactiveBroker } from '../../integrations/live-reactive-broker.mjs';
import { openCodexTransport } from '../../integrations/live-codex-transport.mjs';

const browserMode = process.argv.includes('--browser');
const counters = { barriers: 0, actorAborts: 0, observedBrowserHosts: new Set() };
const fixture = fileURLToPath(new URL('./native-fixture.mjs', import.meta.url));
const firstText = 'Public creation=amber-loop; revision=1.';
const contexts = [], terminals = new Map(), waiters = new Map();
const began = performance.now(), cpu = process.cpuUsage();
const hostFiles = ['integrations/live-output.mjs', 'integrations/live-conversation.mjs',
  'integrations/live-codex-transport.mjs', 'integrations/live-reactive-broker.mjs'];
const sourceHashes = () => Object.fromEntries(hostFiles.map(name => [name,
  createHash('sha256').update(readFileSync(new URL('../../' + name, import.meta.url))).digest('hex')]));
const beforeHashes = sourceHashes();


async function until(predicate) {
  const deadline = performance.now() + 4000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw Error('probe_wait_timeout');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

async function openPage() {
  if (!browserMode) {
    const api = { reactiveUserIntent: () => { counters.barriers++; }, selectThread() {} };
    return { page: { evaluate: async (fn, value) => {
      const previous = globalThis.window;
      globalThis.window = { fischLive: api };
      try { return await fn(value); } finally { globalThis.window = previous; }
    } }, close: async () => {}, mediaCalls: async () => null };
  }
  const { openLive } = await import('../../integrations/live-launch.mjs');
  const live = await openLive({ headless: true, assets: false, production: false, inspect: async page => {
    page.on('request', request => counters.observedBrowserHosts.add(new URL(request.url()).hostname));
    await page.route('**/*', route => ['127.0.0.1', 'localhost', ''].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort());
    await page.addInitScript(() => {
      window.publicProbeMediaCalls = 0;
      if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async () => { window.publicProbeMediaCalls++; throw Error('probe_media_disabled'); },
      });
    });
  } });
  return { ...live, mediaCalls: () => live.page.evaluate(() => window.publicProbeMediaCalls) };
}

function completion(turn, signal) {
  if (signal?.aborted) { counters.actorAborts++; return Promise.reject(Error('probe_actor_aborted')); }
  if (terminals.has(turn)) return Promise.resolve(terminals.get(turn));
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); waiters.delete(turn); };
    const abort = () => { counters.actorAborts++; cleanup(); reject(Error('probe_actor_aborted')); };
    const timer = setTimeout(() => { cleanup(); reject(Error('probe_completion_timeout')); }, 4000);
    waiters.set(turn, status => { cleanup(); resolve(status); });
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function nativeClient(socket) {
  const pending = new Map(), received = [];
  let serial = 0;
  socket.on('message', bytes => {
    const value = JSON.parse(bytes.toString());
    received.push(value);
    if (received.length > 64) received.shift();
    const entry = pending.get(value.id);
    if (entry) { clearTimeout(entry.timer); pending.delete(value.id); entry.resolve(value); }
  });
  return { received, call: (method, params = {}) => new Promise((resolve, reject) => {
    if (pending.size >= 16) { reject(Error('probe_rpc_capacity')); return; }
    const id = 'public-native-' + ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('probe_rpc_timeout')); }, 4000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  }), close: () => {
    for (const value of pending.values()) { clearTimeout(value.timer); value.reject(Error('probe_closed')); }
    pending.clear(); socket.terminate();
  } };
}

function receiptFacade(transport, scope) {
  return { interruptUser: transport.interruptUser, submitUser: (params, guard, discard) => {
    const job = scope.submitting;
    if (!job) throw Error('probe_submission_scope_missing');
    return transport.submitUser(params, message => {
      job.rpcId = message.id;
      return guard(message);
    }, discard).then(reply => {
      if (reply.id !== job.rpcId) throw Object.assign(Error('probe_receipt_mismatch'), { uncertain: true });
      job.receipt = Object.freeze({ threadId: params.threadId, turn: reply.result?.turn?.id, status: reply.result?.turn?.status });
      return reply;
    });
  } };
}

async function harness() {
  const live = await openPage(), scope = {};
  let broker, conversation;
  const output = new LiveOutput(() => live.page.evaluate(() => window.fischLive.selectThread()));
  const transport = await openCodexTransport({
    host: { command: process.execPath, args: [fixture] }, args: [], cwd: fileURLToPath(new URL('./', import.meta.url)),
    env: Object.fromEntries(['PATH', 'SYSTEMROOT', 'WINDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
    instructions: 'Public synthetic app-server only.',
    onRequest: message => {
      if (['thread/start', 'thread/resume', 'thread/fork'].includes(message.method)) conversation.selectionAttempt();
      output.request(message); return broker.client(message);
    },
    onEvent: async message => {
      await output.accept(message); broker.event(message); conversation.accept(message);
      if (message.method === 'test/context') contexts.push(message.params);
      if (message.method === 'turn/completed') {
        terminals.set(message.params.turn.id, message.params.turn.status);
        waiters.get(message.params.turn.id)?.(message.params.turn.status);
      }
    },
  });
  broker = new LiveReactiveBroker({ page: live.page, output, provider: null, forward: transport.forward,
    reject: (message, error) => { output.accept({ id: message.id, error }); transport.reject(message, error); } });
  conversation = new LiveConversation({ output, broker, transport: receiptFacade(transport, scope) });
  const socket = new WebSocket(transport.url, { headers: { Authorization: 'Bearer ' + transport.token } });
  const native = nativeClient(socket);
  await once(socket, 'open');
  return { live, output, conversation, native, scope, close: async () => {
    conversation.close(); broker.close(); native.close();
    const results = await Promise.allSettled([transport.close(), live.close()]);
    if (results.some(value => value.status === 'rejected')) throw Error('probe_cleanup_failed');
  } };
}

function port(h, thread) {
  let lastJob;
  return { send: async (text, signal) => {
    if (h.output.thread !== thread) throw Error('probe_session_changed');
    const job = {};
    h.scope.submitting = job;
    let pending;
    try { pending = h.conversation.send({ text, generation: h.conversation.snapshot().generation }); }
    finally { h.scope.submitting = undefined; }
    await pending;
    const owner = job.receipt;
    if (!owner?.turn || owner.threadId !== thread) throw Error('probe_owner_unknown');
    lastJob = owner;
    return completion(owner.turn, signal);
  }, captureCancel: () => {
    const owner = lastJob;
    return async () => {
      // No await between authoritative owner comparison and controller capture.
      if (!owner || h.output.thread !== owner.threadId || h.output.turn !== owner.turn) throw Error('probe_owner_changed');
      const terminal = completion(owner.turn);
      const pending = h.conversation.cancel({ generation: h.conversation.snapshot().generation });
      await pending;
      return terminal;
    };
  } };
}

function session(h, thread) {
  const io = port(h, thread);
  const machine = setup({ actors: {
    send: fromPromise(({ input, signal }) => io.send(input, signal)),
    cancel: fromPromise(() => io.captureCancel()()),
  } }).createMachine({ initial: 'idle', context: { text: '', finished: 0 }, states: {
    idle: { on: { SEND: { target: 'running', actions: assign({ text: ({ event }) => event.text }) } } },
    running: { invoke: { src: 'send', input: ({ context }) => context.text,
      onDone: { target: 'idle', actions: assign({ finished: ({ context }) => context.finished + 1 }) }, onError: 'unknown' },
      on: { CANCEL: 'cancelling' } },
    cancelling: { invoke: { src: 'cancel', onDone: 'idle', onError: 'unknown' } },
    unknown: { on: { RESET: 'idle' } },
  } });
  const actor = createActor(machine).start();
  return { actor, captureCancel: io.captureCancel };
}

async function contextAndCancel(h, a) {
  for (const [index, text] of [firstText, 'Public follow-up on that creation.'].entries()) {
    a.actor.send({ type: 'SEND', text });
    await until(() => a.actor.getSnapshot().context.finished === index + 1);
  }
  await h.native.call('test/hold');
  a.actor.send({ type: 'SEND', text: 'Public held response.' });
  await until(() => h.output.turn && h.conversation.snapshot().canCancel);
  a.actor.send({ type: 'CANCEL' });
  await until(() => a.actor.getSnapshot().value === 'idle');
  const messages = JSON.stringify(h.conversation.snapshot().messages);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(JSON.stringify(h.conversation.snapshot().messages), messages);
  assert(h.native.received.some(value => value.params?.delta === 'PUBLIC_STALE_CALLBACK'));
  const rows = contexts.filter(value => value.threadId === 'public-session-a');
  assert.deepEqual(rows.map(value => value.priorUserCount), [0, 1, 2]);
  assert.deepEqual(rows[2].priorRoles, ['user', 'assistant', 'user', 'assistant']);
  assert.equal(rows[1].firstUserHash, createHash('sha256').update(firstText).digest('hex'));
}

async function staleAfterCapture(h, a) {
  const oldCancel = a.captureCancel();
  const before = (await h.native.call('test/stats')).result.interruptCalls;
  await h.native.call('test/newer', { threadId: 'public-session-a' });
  await until(() => h.output.turn === 'public-newer-same-generation');
  await assert.rejects(oldCancel, /probe_owner_changed/);
  assert.equal((await h.native.call('test/stats')).result.interruptCalls, before);
  assert.equal(h.output.turn, 'public-newer-same-generation');
  const terminal = completion(h.output.turn);
  await h.conversation.cancel({ generation: h.conversation.snapshot().generation });
  await terminal;
}

async function staleBeforeCapture(h, a) {
  await h.native.call('test/reorder');
  a.actor.send({ type: 'SEND', text: 'Public completion-before-ACK ordering.' });
  await until(() => a.actor.getSnapshot().context.finished === 3);
  assert.equal(h.output.turn, 'public-newer-before-ack');
  const before = (await h.native.call('test/stats')).result.interruptCalls;
  await assert.rejects(a.captureCancel(), /probe_owner_changed/);
  assert.equal((await h.native.call('test/stats')).result.interruptCalls, before);
  assert.equal(h.output.turn, 'public-newer-before-ack');
  const terminal = completion(h.output.turn);
  await h.conversation.cancel({ generation: h.conversation.snapshot().generation });
  await terminal;
}


async function earlyCancellation(h, a) {
  await h.native.call('test/delayedAck');
  const before = (await h.native.call('test/stats')).result.interruptCalls;
  const count = contexts.length;
  a.actor.send({ type: 'SEND', text: 'Public early cancellation before receipt.' });
  await until(() => contexts.length > count && h.conversation.snapshot().pending);
  a.actor.send({ type: 'CANCEL' });
  await until(() => a.actor.getSnapshot().value === 'unknown');
  await until(() => !h.conversation.snapshot().pending);
  assert.equal((await h.native.call('test/stats')).result.interruptCalls, before);
  const terminal = completion(h.output.turn);
  await h.conversation.cancel({ generation: h.conversation.snapshot().generation });
  await terminal;
}

async function unknownAndIsolation(h) {
  await h.native.call('thread/resume', { threadId: 'public-session-b' });
  const b = session(h, 'public-session-b');
  try {
    assert.deepEqual(h.conversation.snapshot().messages, []);
    b.actor.send({ type: 'SEND', text: 'Public isolated B request.' });
    await until(() => b.actor.getSnapshot().context.finished === 1);
    assert.equal(contexts.find(value => value.threadId === 'public-session-b').priorUserCount, 0);
    await h.native.call('test/malformed');
    b.actor.send({ type: 'SEND', text: 'Public malformed-ACK probe.' });
    await until(() => b.actor.getSnapshot().value === 'unknown');
    b.actor.send({ type: 'RESET' });
    b.actor.send({ type: 'SEND', text: 'Must not be automatically resent.' });
    await until(() => b.actor.getSnapshot().value === 'unknown');
    assert.equal(contexts.filter(value => value.threadId === 'public-session-b').length, 2);
    assert.equal(h.conversation.snapshot().canSend, false);
  } finally { b.actor.stop(); }
}

const h = await harness();
let a;
try {
  await h.native.call('thread/resume', { threadId: 'public-session-a' });
  a = session(h, 'public-session-a');
  await contextAndCancel(h, a);
  await staleAfterCapture(h, a);
  await staleBeforeCapture(h, a);
  await earlyCancellation(h, a);
  await unknownAndIsolation(h);
  assert(!h.native.received.some(value => typeof value.id === 'string' && value.id.startsWith('fisch:')));
  assert.deepEqual(sourceHashes(), beforeHashes);
  const cost = process.cpuUsage(cpu);
  const result = {
    schemaVersion: 1, component: 'xstate@5.33.4',
    hostHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }).trim(),
    hostFiles: beforeHashes,
    upstreamEntrySha256: createHash('sha256').update(readFileSync(new URL(import.meta.resolve('xstate')))).digest('hex'), upstreamCommit: 'bd77717b8d33c49af1c8ee4a7e22cebb936cc8b1',
    mode: browserMode ? 'actual-page-canonical-Node-port' : 'injected-page-canonical-Node-port',
    agent: 'public synthetic app-server; no real model', ownershipSource: 'correlated raw owned RPC receipt, not global output after await',
    actualUpstreamActorRuntime: true, contextPriorUserCounts: [0, 1, 2], actualFixtureHistoryRolesChecked: true,
    confirmedNativeInterruption: true, staleCallbackArrivedAndDropped: true,
    staleCancelAfterCaptureBlocked: true, completionBeforeAckWithNewerOwnerBlocked: true,
    earlyCancelBeforeReceipt: 'unknown/no interrupt; no replay after late ACK', sessionBContextIsolated: true, unknownSurvivedActorReset: true, privateOwnedAckLeaked: false,
    actorAbortSignals: counters.actorAborts,
    barrierCalls: browserMode ? null : counters.barriers,
    mediaCalls: await h.live.mediaCalls(), observedBrowserHosts: [...counters.observedBrowserHosts],
    elapsedMs: performance.now() - began, parentMaxRSSKB: process.resourceUsage().maxRSS,
    parentCpuMs: (cost.user + cost.system) / 1000, processTreePeakRSS: null,
    realModelCalls: 0, realAccountCredentials: 0,
    limitations: ['Synthetic history is not real-model coherence.', 'No MCP mutation in this probe; use the separate capability probe.',
      'RSS/CPU cover the Node parent only; null counters are unmeasured, not zero.',
      'The generic browser stop-current API remains unsuitable for stale machine cancellation.'],
  };
  if (process.env.FISCH_REUSE_RESULT) writeFileSync(process.env.FISCH_REUSE_RESULT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { a?.actor.stop(); await h.close(); }
