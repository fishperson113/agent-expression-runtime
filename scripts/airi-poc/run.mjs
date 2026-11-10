import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const upstreamCommit = '822243de34e8d1151202ac2f688f83d68d04289c';
const require = createRequire(import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function loadComponent(source, output) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  assert.equal(commit, upstreamCommit, 'Upstream checkout must match the pinned revision');
  const files = ['packages/core-agent/src/runtime/chat-orchestrator-runtime.ts',
    'packages/core-agent/src/runtime/context-registry.ts', 'packages/stream-kit/src/queue.ts'];
  const changed = execFileSync('git', ['diff', 'HEAD', '--', ...files], { cwd: source, encoding: 'utf8' });
  assert.equal(changed, '', 'Do not execute patched upstream entrypoints');
  const result = await build({ entryPoints: files.slice(0, 2).map(file => join(source, file)),
    outdir: output, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, metafile: true,
    alias: Object.fromEntries([['@proj-airi/stream-kit', join(source, files[2])],
      ...['unified', 'rehype-parse', 'rehype-stringify', 'unist-util-visit'].map(name => [name, require.resolve(name)])]) });
  await cp(join(source, 'LICENSE'), join(output, 'UPSTREAM-LICENSE'));
  const inputs = await Promise.all(Object.keys(result.metafile.inputs).map(async file => {
    const absolute = resolve(file), bytes = await readFile(absolute);
    const inside = relative(source, absolute);
    const upstream = inside !== '' && !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep);
    const path = upstream ? inside.split(sep).join('/') : file;
    if (upstream) assert.equal(digest(bytes), digest(execFileSync('git', ['show', `${upstreamCommit}:${path}`], { cwd: source })), 'Bundled upstream input differs from pinned git object');
    return { origin: upstream ? 'upstream' : 'dependency', file: path, sha256: digest(bytes) };
  }));
  const runtime = await import(pathToFileURL(join(output, 'chat-orchestrator-runtime.mjs')));
  const context = await import(pathToFileURL(join(output, 'context-registry.mjs')));
  return { ...runtime, ...context, provenance: { commit, bundledInputs: inputs, sourcePatches: 0 } };
}

export function ownedContext(createRegistry, identity) {
  const owner = Object.freeze(structuredClone(identity));
  const registry = createRegistry({ historyLimit: 12 });
  let valid = true;
  const matches = value => valid && value?.user === owner.user && value.session === owner.session && value.epoch === owner.epoch;
  return {
    ingest(value, current) {
      if (!matches(current)) throw Error('context_owner_stale');
      if (!value || !['replace-self', 'append-self'].includes(value.strategy) ||
        typeof value.source !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.source) || ['__proto__', 'prototype', 'constructor'].includes(value.source) ||
        typeof value.text !== 'string' || Buffer.byteLength(value.text) > 1024) throw Error('context_invalid');
      const copy = Object.assign(Object.create(null), registry.snapshot());
      const bucket = Object.hasOwn(copy, value.source) ? copy[value.source] : [];
      copy[value.source] = value.strategy === 'replace-self' ? [value] : [...bucket, value];
      if (Object.keys(copy).length > 4 || Object.values(copy).some(items => items.length > 4) ||
        Buffer.byteLength(JSON.stringify(copy)) > 8192) throw Error('context_capacity');
      return registry.ingest({ source: value.source, text: value.text, strategy: value.strategy });
    },
    snapshot(current) { if (!matches(current)) throw Error('context_owner_stale'); return registry.snapshot(); },
    history(current) { if (!matches(current)) throw Error('context_owner_stale'); return registry.contextHistory(); },
    removeWriter(source, current) { if (!matches(current)) throw Error('context_owner_stale'); return registry.removeWriter(source); },
    clear() { valid = false; registry.reset(); },
    empty() { return Object.keys(registry.snapshot()).length === 0 && registry.contextHistory().length === 0; },
  };
}

function probeBounds(createRegistry) {
  const owner = { user: 'public-A', session: 'A', epoch: 'one' };
  const store = ownedContext(createRegistry, owner);
  const context = { source: 'scene', strategy: 'append-self', text: 'Public amber-loop context.' };
  for (const source of ['__proto__', 'prototype', 'constructor']) assert.throws(() => store.ingest({ ...context, source }, owner), /context_invalid/);
  assert.equal(store.history(owner).length, 0); assert.deepEqual(store.snapshot(owner), {});
  for (let count = 0; count < 4; count++) store.ingest(context, owner);
  for (let count = 0; count < 1000; count++) assert.throws(() => store.ingest(context, owner), /context_capacity/);
  assert.equal(store.snapshot(owner).scene.length, 4);
  for (const field of ['user', 'session', 'epoch']) assert.throws(() => store.ingest(context, { ...owner, [field]: 'wrong' }), /owner_stale/);
  assert.throws(() => store.ingest({ ...context, text: 'x'.repeat(1025) }, owner), /context_invalid/);
  store.removeWriter('scene', owner);
  assert.equal(store.history(owner).length, 4, 'Writer removal is not a privacy wipe');
  store.clear(); assert(store.empty()); assert.throws(() => store.ingest(context, owner), /owner_stale/);
  const writers = ownedContext(createRegistry, owner);
  for (let count = 0; count < 4; count++) writers.ingest({ ...context, source: `writer${count}` }, owner);
  assert.throws(() => writers.ingest({ ...context, source: '__proto__' }, owner), /context_invalid/);
  assert.throws(() => writers.ingest({ ...context, source: 'writer4' }, owner), /context_capacity/);
  assert.equal(Object.keys(writers.snapshot(owner)).length, 4); assert.equal(writers.history(owner).length, 4); writers.clear();
  const external = { ...owner }, isolated = ownedContext(createRegistry, external);
  external.epoch = 'mutated'; isolated.ingest(context, owner); isolated.clear();
  return { appendFloodRejected: 1000, ownerFields: ['user', 'session', 'epoch'], privacyReset: true };
}

function sessionRuntime(component, id, stream, records) {
  const owner = { user: `public-${id}`, session: id, epoch: 'one' };
  const context = ownedContext(component.createContextRegistry, owner);
  const messages = [];
  context.ingest({ source: 'scene', strategy: 'replace-self', text: `Public ${id} scene context.` }, owner);
  const runtime = component.createChatOrchestratorRuntime({
    session: { getSessionMessages: () => messages, getSessionGeneration: () => 1,
      commitUserMessage: async (session, message) => { messages.push(structuredClone(message)); return { status: 'inserted', messageId: message.id }; },
      commitAssistantMessage: async (session, message) => { messages.push(structuredClone(message)); } },
    context: { ingest: value => context.ingest(value, owner), snapshot: () => context.snapshot(owner) },
    foregroundStream: { patch: value => records.patches.push(structuredClone(value)), reset() {} },
    llm: { stream }, getActiveSessionId: () => id, getActiveProvider: () => 'synthetic-only',
    onSendSettled: value => records.settled.push(value.status),
  });
  const provider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://invalid.example/' } }) };
  return { runtime, messages, context, send: (text, turn) => runtime.submit(text, { model: turn, chatProvider: provider, messageId: turn }, id) };
}

async function probeRuntime(component) {
  const contexts = [], records = { patches: [], settled: [] };
  const held = Promise.withResolvers(), started = Promise.withResolvers();
  let late, signal;
  const stream = async (model, provider, conversation, options) => {
    contexts.push({ model, conversation: structuredClone(conversation) });
    if (model === 'held') { late = options.onStreamEvent; signal = options.abortSignal; started.resolve(); await held.promise; return; }
    await options.onStreamEvent({ type: 'text-delta', text: 'Public synthetic reply.' });
    await options.onStreamEvent({ type: 'finish' });
  };
  const a = sessionRuntime(component, 'A', stream, records), b = sessionRuntime(component, 'B', stream, records);
  try {
    await a.send('Public amber-loop first intent', 'first').done;
    await a.send('Public amber-loop second intent', 'second').done;
    assert(JSON.stringify(contexts[1].conversation).includes('amber-loop first'));
    assert(JSON.stringify(contexts[1].conversation).includes('Public A scene context.'));
    const pending = a.send('Public held intent', 'held'); await started.promise;
    await b.send('Public isolated B intent', 'other').done;
    assert(!JSON.stringify(contexts.at(-1).conversation).includes('amber-loop'));
    assert(!JSON.stringify(contexts.at(-1).conversation).includes('Public A scene context.'));
    a.runtime.cancelTurn({ sessionId: 'A', turnId: 'wrong' }); assert.equal(signal.aborted, false);
    a.runtime.cancelTurn({ sessionId: 'A', turnId: 'held' }); await pending.done; assert.equal(signal.aborted, true);
    await a.send('Public replacement intent', 'replacement').done;
    const saved = JSON.stringify(a.messages), count = records.patches.length;
    await late({ type: 'text-delta', text: 'PUBLIC_STALE_DROP' }); await late({ type: 'finish' });
    assert.equal(JSON.stringify(a.messages), saved); assert.equal(records.patches.length, count);
    return { injectedLlmCalls: contexts.length, settled: records.settled, concurrentOwnerIsolation: true, lateOutputDropped: true };
  } finally {
    held.resolve(); a.runtime.cancelPendingSends(); b.runtime.cancelPendingSends(); a.context.clear(); b.context.clear();
  }
}

async function main() {
  const source = process.env.AIRI_SOURCE;
  if (!source) throw Error('Set AIRI_SOURCE to the exact pinned upstream checkout; no automatic downloads');
  const output = await mkdtemp(join(tmpdir(), 'fisch-airi-component-'));
  const started = performance.now();
  try {
    const component = await loadComponent(await realpath(resolve(source)), output);
    const result = { scope: 'experimental synthetic component evidence; no production adoption',
      provenance: component.provenance, bounds: probeBounds(component.createContextRegistry), runtime: await probeRuntime(component) };
    if (process.argv.includes('--browser')) {
      if (!process.argv.includes('--unsafe-cancel-research')) throw Error('Browser adapter cancellation is known unsafe for newer same-generation owners; explicit research flag required');
      const { probeBrowser } = await import('./browser.mjs');
      result.browser = await probeBrowser(component, process.env.FISCH_POC_ROOT);
    }
    result.metrics = { elapsedMs: performance.now() - started, parentRssBytes: process.memoryUsage().rss,
      parentPeakRssBytes: process.resourceUsage().maxRSS * 1024, processTreePeakRssBytes: null, downloadBytes: null };
    console.log(JSON.stringify(result));
  } finally { await rm(output, { recursive: true, force: true }); }
}
await main();
