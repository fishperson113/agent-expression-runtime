// Actual product launcher and MCP proof, with a public scripted Native agent.
// This probe deliberately has NO machine-cancel port through the browser API.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createActor, setup, fromPromise, assign } from 'xstate';
import { runLiveSession } from '../../scripts/live-session.mjs';
import { openLive } from '../../integrations/live-launch.mjs';
import { runTerminalCodex } from '../../integrations/live-terminal.mjs';
import { awaitResearchReady, closeResearchRoute } from './startup-contract.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceFiles = ['integrations/live-terminal.mjs', 'integrations/live-conversation.mjs',
  'integrations/live-codex-transport.mjs', 'src/live/main.ts', 'tests/fixtures/playground-agent.mjs'];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(name => [name,
  createHash('sha256').update(readFileSync(new URL('../../' + name, import.meta.url))).digest('hex')]));
const beforeHashes = sourceHashes();
const hosts = new Set();
const results = [];
const began = performance.now(), cpu = process.cpuUsage();

async function until(predicate, timeout = 15000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('capability_probe_timeout');
}

function stdoutLines(stream, ready) {
  let buffer = '';
  stream.on('data', bytes => {
    buffer += bytes;
    if (buffer.length > 1048576) { stream.destroy(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const row = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (row.type === 'ready') ready.resolve(row);
      if (row.type === 'result') results.push(row);
      if (results.length > 32) results.shift();
    }
  });
}

async function launch() {
  const abort = new AbortController(), ready = Promise.withResolvers();
  let live, child;
  const running = runLiveSession({ headless: true, assets: false, signal: abort.signal,
    open: options => openLive({ ...options, production: false, synthetic: true, inspect: async page => {
      page.on('request', request => hosts.add(new URL(request.url()).hostname));
      await page.route('**/*', route => ['127.0.0.1', 'localhost', ''].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort());
      await page.addInitScript(() => {
        window.publicProbeMediaCalls = 0;
        if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
          value: async () => { window.publicProbeMediaCalls++; throw Error('probe_media_disabled'); },
        });
      });
    } }).then(async opened => {
      await opened.page.evaluate(() => {
        const api = window.fischLive, original = api.conversationStatus;
        api.conversationStatus = value => { window.publicProbeConversation = structuredClone(value); original(value); };
      });
      return opened;
    }),
    runHost: options => {
      live = options.live;
      return runTerminalCodex({ ...options, reactiveProvider: null,
        host: { command: process.execPath, args: [fileURLToPath(new URL('../../tests/fixtures/playground-agent.mjs', import.meta.url))] },
        spawnClient: (command, args, settings) => {
          child = spawn(command, args, { ...settings, stdio: ['pipe', 'pipe', 'pipe'] });
          child.stderr.resume(); stdoutLines(child.stdout, ready); return child;
        },
      });
    },
  });
  const close = hasPrimaryError => closeResearchRoute(abort, child, running, hasPrimaryError);
  try {
    const metadata = await awaitResearchReady(ready.promise, running);
    await until(() => live.page.evaluate(() => window.publicProbeConversation?.canSend));
    return { live, metadata, close };
  } catch (error) { await close(true); throw error; }
}

function actorFor(page, generation) {
  const machine = setup({ actors: { send: fromPromise(async ({ input }) => {
    const before = await page.evaluate(() => window.publicProbeConversation);
    if (before.generation !== generation) throw Error('capability_session_changed');
    await page.evaluate(value => window.fischLiveConversation(value), { action: 'send', generation, text: input });
    await until(async () => {
      const state = await page.evaluate(() => window.publicProbeConversation);
      if (state.generation !== generation || state.error) throw Error('capability_state_unknown');
      return state.revision > before.revision && state.canSend && !state.pending && !state.canCancel;
    });
  }) } }).createMachine({ initial: 'idle', context: { text: '', finished: 0 }, states: {
    idle: { on: { SEND: { target: 'running', actions: assign({ text: ({ event }) => event.text }) } } },
    running: { invoke: { src: 'send', input: ({ context }) => context.text,
      onDone: { target: 'idle', actions: assign({ finished: ({ context }) => context.finished + 1 }) }, onError: 'unknown' } },
    unknown: {},
  } });
  return createActor(machine).start();
}

function publicScene() {
  return { parts: [
    { id: 'amber-loop-oss-7', kind: 'ellipsoid', center: [-0.2, 0, 0], scale: [0.28, 0.12, 0.12] },
    { id: 'public-tail-oss-9', kind: 'ellipsoid', center: [0.2, -0.1, 0], scale: [0.1, 0.22, 0.08] },
  ], style: { color: '#2199ac', brightness: 0.8, pointSize: 1.2, dispersion: 0.1 },
  flow: { field: 'pulse', strength: 0.1 }, goal: 'Public synthetic geometry fixture' };
}

async function creativeSequence(route, actor) {
  const original = publicScene(), remix = structuredClone(original), snapshots = [];
  remix.parts[0].center = [-0.1, 0.15, 0];
  let finished = 0;
  for (const [operation, scene] of [['create', original], ['remix', remix], ['undo', undefined]]) {
    actor.send({ type: 'SEND', text: JSON.stringify({ operation, ...(scene ? { scene } : {}) }) });
    const completedOrdinal = ++finished;
    await until(() => actor.getSnapshot().context.finished === completedOrdinal);
    assert(results.some(row => row.command === operation && row.value.status === 'committed'));
    actor.send({ type: 'SEND', text: JSON.stringify({ operation: 'state', includeScene: true }) });
    const expected = ++finished;
    await until(() => actor.getSnapshot().context.finished === expected);
    snapshots.push(results.findLast(row => row.command === 'state').value);
  }
  assert.deepEqual(snapshots.map(value => value.revision), [1, 2, 3]);
  const expected = structuredClone(snapshots[0].scene);
  expected.parts[0].center = remix.parts[0].center;
  assert.deepEqual(snapshots[1].scene, expected);
  assert.deepEqual(snapshots[2].scene, snapshots[0].scene);
  return snapshots;
}

async function renderProof(page) {
  return until(async () => {
    const metrics = await page.evaluate(() => window.fischLive.metrics());
    const applied = metrics.diagnostics.events.find(event => event.origin === 'native'
      && event.phase === 'applied' && event.epoch !== 'local');
    if (!applied) return;
    const events = metrics.diagnostics.events.filter(event => event.origin === 'native'
      && event.epoch === applied.epoch && event.seq === applied.seq);
    const phases = events.map(event => event.phase);
    if (!['applied', 'completed', 'frame_submitted', 'frame_changed_proxy'].every(phase => phases.includes(phase))) return;
    return { scene: metrics.scene, cameraActive: metrics.cameraActive, parts: metrics.parts,
      sequence: applied.seq, epoch: applied.epoch, phases, renderFrame: metrics.render?.frame,
      completedEvents: metrics.diagnostics.events.filter(event => event.origin === 'native' && event.phase === 'completed').length };
  });
}

const route = await launch();
let actor, failed = false;
try {
  assert(route.metadata.tools.includes('playground_edit'));
  const generation = await route.live.page.evaluate(() => window.publicProbeConversation.generation);
  actor = actorFor(route.live.page, generation);
  const snapshots = await creativeSequence(route, actor);
  const proof = await renderProof(route.live.page);
  assert.equal(proof.scene, 'assembled');
  assert.deepEqual(proof.parts, ['amber-loop-oss-7', 'public-tail-oss-9']);
  assert(proof.completedEvents >= 6);
  assert.equal(proof.cameraActive, false);
  assert.equal(await route.live.page.evaluate(() => window.publicProbeMediaCalls), 0);
  assert.deepEqual(sourceHashes(), beforeHashes);
  const cost = process.cpuUsage(cpu);
  const result = { schemaVersion: 1, component: 'xstate@5.33.4',
    hostHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), hostFiles: beforeHashes,
    actorRuntime: 'actual upstream package', agent: 'public scripted Native fixture, not inference',
    path: 'XState → existing browser conversation binding → owned Native transport → configured MCP → Rust gateway → scheduler/render',
    operations: ['create', 'remix', 'undo'], revisions: snapshots.map(value => value.revision),
    onlyDeclaredCenterChanged: true, undoRestoredCanonicalScene: true, proof,
    mediaCalls: 0, observedBrowserHosts: [...hosts], realModelCalls: 0,
    elapsedMs: performance.now() - began, parentMaxRSSKB: process.resourceUsage().maxRSS,
    parentCpuMs: (cost.user + cost.system) / 1000, processTreePeakRSS: null,
    limitations: ['No machine CANCEL is connected to the browser stop-current API.',
      'The synthetic full-scene fixture does not establish real-model creativity or human enjoyment.',
      'The frame change is an application proxy, not a semantic score.'],
  };
  if (process.env.FISCH_REUSE_RESULT) writeFileSync(process.env.FISCH_REUSE_RESULT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) { failed = true; throw error; }
finally { actor?.stop(); await route.close(failed); }
