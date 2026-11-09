import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const sourceSha = '354d6428ea29255229a9a24c67332583bc7635bc';
const repository = fileURLToPath(new URL('..', import.meta.url));
const fixture = new URL('../integrations/reactive-wall-page.mjs', import.meta.url);

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return null;
  let mode = '--smoke', explicit = false, output;
  for (let i = 0; i < args.length; i++) {
    if (['--smoke', '--full'].includes(args[i])) {
      if (explicit) throw Error('probe_arguments');
      mode = args[i]; explicit = true;
    } else if (args[i] === '--output' && !output && args[i + 1] && !args[i + 1].startsWith('--')) output = args[++i];
    else throw Error('probe_arguments');
  }
  return { mode, plan: mode === '--full' ? { quietMs: 600000, activeMs: 600000 } : { quietMs: 20000, activeMs: 30000 },
    output: resolve(output ?? join(repository, '.runtime', mode === '--full' ? 'reactive-wall-full.json' : 'reactive-wall-smoke.json')) };
}

export function summarizeNumbers(values) {
  if (!values.length) return { count: 0, min: null, max: null, p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, min: sorted[0], max: sorted.at(-1),
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

function sourceSnapshot() {
  const directory = mkdtempSync(join(tmpdir(), 'fisch-reactive-wall-')), root = join(directory, 'source');
  try {
    const resolved = execFileSync('git', ['rev-parse', sourceSha + '^{commit}'], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (resolved !== sourceSha) throw Error('probe_source_missing');
    const archive = execFileSync('git', ['archive', sourceSha], { cwd: repository, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    mkdirSync(root);
    execFileSync('tar', ['-xf', '-', '-C', root], { input: archive, stdio: ['pipe', 'ignore', 'ignore'] });
    symlinkSync(realpathSync(join(repository, 'node_modules')), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    return { directory, root };
  } catch {
    rmSync(directory, { recursive: true, force: true });
    throw Error('probe_source_or_dependencies_unavailable');
  }
}

function virtualPagePlugin() {
  return { name: 'synthetic-reactive-wall-probe',
    resolveId(id) { if (id === '/__probe-entry.js') return '\0reactive-wall'; },
    load(id) { if (id === '\0reactive-wall') return readFileSync(fixture, 'utf8'); },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__probe') return next();
        const html = '<!doctype html><html><head><meta charset="utf-8"><title>Synthetic reactive wall probe</title></head>' +
          '<body style="margin:0;background:#101820"><canvas style="width:800px;height:600px;display:block"></canvas>' +
          '<script type="module" src="/__probe-entry.js"></script></body></html>';
        response.setHeader('Content-Type', 'text/html');
        response.end(await server.transformIndexHtml('/__probe', html));
      });
    } };
}

export async function cleanupOwned(runtime, removeSnapshot = () => {}) {
  try {
    await Promise.allSettled([
      Promise.resolve().then(() => runtime?.broker?.close()),
      Promise.resolve().then(() => runtime?.browser?.close()),
      Promise.resolve().then(() => runtime?.server?.close()),
    ]);
  } finally {
    try { await removeSnapshot(); } catch {}
  }
}

async function openRuntime(snapshot, state) {
  const require = createRequire(join(snapshot.root, 'package.json'));
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
  const { chromium } = require('@playwright/test');
  const runtime = { snapshot };
  try {
    runtime.server = await createServer({ root: snapshot.root, configFile: false, logLevel: 'silent',
      cacheDir: join(snapshot.directory, 'vite-cache'), server: { host: '127.0.0.1', port: 0 }, plugins: [virtualPagePlugin()] });
    await runtime.server.listen();
    runtime.browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    runtime.page = await runtime.browser.newPage({ viewport: { width: 900, height: 700 } });
    runtime.page.on('pageerror', () => { state.pageErrors++; });
    await runtime.page.goto(runtime.server.resolvedUrls.local[0] + '__probe');
    await runtime.page.waitForFunction(() => window.wallProbe?.ready, null, { timeout: 20000 });
    await runtime.page.waitForTimeout(1200);
    return runtime;
  } catch (error) {
    await cleanupOwned(runtime);
    throw error;
  }
}

function initialState() {
  return { measuring: false, pageErrors: 0, pollCount: 0, codes: {}, gaps: [], delays: [], overflow: 0,
    outstanding: new Map(), counts: { quiet: { requested: 0, returned: 0 }, active: { requested: 0, returned: 0 } } };
}

function fakeProvider(state, plan) {
  return { async decide(window, signal) {
    const request = window.request, began = performance.now();
    const phase = window.events.at(-1).at - state.startWall < plan.quietMs ? 'quiet' : 'active';
    if (state.measuring) {
      state.counts[phase].requested++; state.outstanding.set(request.requestId, phase);
    }
    await delay(2000, undefined, { signal });
    if (state.measuring) {
      state.counts[phase].returned++; state.delays.push(performance.now() - began); state.outstanding.delete(request.requestId);
    }
    return { schemaVersion: 1, requestId: request.requestId, decisionId: 'd_' + request.requestId, mode: 'express', validUntil: request.deadline,
      action: { actionId: 'a_' + request.requestId, body: { type: 'shapeQuality', rise: 0.15, advance: 0, grow: 1, spread: 1, durationMs: 600 } } };
  } };
}

async function measure(runtime, state, options) {
  const { LiveReactiveBroker } = await import(pathToFileURL(join(runtime.snapshot.root, 'integrations/live-reactive-broker.mjs')).href);
  const meta = await runtime.page.evaluate(plan => window.wallProbe.start(plan), options.plan);
  state.startWall = meta.wallStart; state.startHost = performance.now(); state.measuring = true;
  runtime.broker = new LiveReactiveBroker({ page: runtime.page, provider: fakeProvider(state, options.plan), output: { thread: 'probe', state: 'idle' },
    forward: () => { throw Error('probe_no_user_forward'); }, reject: () => {}, log: value => {
      if (!state.measuring) return;
      const code = /^[a-z_]{1,64}$/.test(value) ? value : 'other'; state.codes[code] = (state.codes[code] ?? 0) + 1;
    } });
  const duration = options.plan.quietMs + options.plan.activeMs;
  while (performance.now() - state.startHost < duration) {
    const began = performance.now();
    if (state.lastPoll !== undefined) { if (state.gaps.length < 20000) state.gaps.push(began - state.lastPoll); else state.overflow++; }
    state.lastPoll = began; state.pollCount++;
    await runtime.broker.poll({ turn: 'idle', output: 0, quality: 'synthetic_probe' });
    if (state.pollCount % 300 === 0) await progress(runtime, state, options);
    await delay(Math.max(0, 100 - (performance.now() - began)));
  }
  state.endHost = performance.now(); state.measuring = false;
}

async function progress(runtime, state, options) {
  const browser = await runtime.page.evaluate(() => window.wallProbe.peek());
  const value = { mode: options.mode, hostElapsedMs: performance.now() - state.startHost, browserElapsedMs: browser.elapsedMs,
    sourceFrames: Object.fromEntries(Object.entries(browser.phases).map(([name, data]) => [name, data.sourceFrames])), provider: state.counts, pageErrors: state.pageErrors };
  writeFileSync(options.output + '.progress.json', JSON.stringify(value, null, 2));
  console.log(JSON.stringify({ phase: 'progress', elapsedSeconds: Math.round(value.hostElapsedMs / 1000), providerRequested: state.counts.quiet.requested + state.counts.active.requested }));
}

async function report(runtime, state, options) {
  const broker = runtime.broker;
  const brokerAtEnd = { active: Number(!!broker.active), uncertain: broker.uncertain, paused: broker.paused, browserUnavailable: broker.browserUnavailable,
    uniqueRequests: broker.requests.size, pendingUserMessages: broker.pending.size, queuedUserMessages: broker.queue.length };
  const outstanding = { quiet: 0, active: 0 };
  for (const phase of state.outstanding.values()) outstanding[phase]++;
  broker.close();
  const browser = await runtime.page.evaluate(() => window.wallProbe.end());
  const gpu = await runtime.page.locator('canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  const duration = options.plan.quietMs + options.plan.activeMs;
  return { sourceSha, execution: 'real-wall-browser-broker-synthetic-provider', maintainedRunner: true,
    originalRecordedRun: false, mode: options.mode, plan: options.plan, nodeVersion: process.version, browserVersion: runtime.browser.version(),
    hostElapsedMs: state.endHost - state.startHost, browserElapsedMs: browser.elapsedMs,
    durationEligible: state.endHost - state.startHost >= duration && browser.elapsedMs >= duration,
    fakeProviderLatencyMs: 2000, fakeProviderProgram: 'shapeQuality rise=.15 advance=0 grow=1 spread=1 duration600ms',
    realModelCalls: 0, cameraOrMicrophoneCalls: browser.mediaCalls, gpu, pageErrors: state.pageErrors, pollCount: state.pollCount,
    timingAggregateOverflow: state.overflow, actualPollGapMs: summarizeNumbers(state.gaps), actualProviderLatencyMs: summarizeNumbers(state.delays),
    providerByOpportunityCohort: state.counts, providerOutstandingAtEnd: outstanding, brokerAtEnd, brokerCodes: state.codes, browser };
}

export async function runProbe(options) {
  const snapshot = sourceSnapshot(), state = initialState(); let runtime;
  try {
    mkdirSync(dirname(options.output), { recursive: true });
    runtime = await openRuntime(snapshot, state);
    console.log(JSON.stringify({ phase: 'started', mode: options.mode, sourceSha, output: options.output }));
    await measure(runtime, state, options);
    const result = await report(runtime, state, options);
    writeFileSync(options.output, JSON.stringify(result, null, 2));
    await runtime.page.evaluate(() => window.wallProbe.dispose());
    console.log(JSON.stringify({ phase: 'finished', output: options.output, hostElapsedMs: result.hostElapsedMs, browserElapsedMs: result.browserElapsedMs, pageErrors: result.pageErrors }));
    return result;
  } finally {
    state.measuring = false;
    await cleanupOwned(runtime, () => rmSync(snapshot.directory, { recursive: true, force: true }));
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options) await runProbe(options);
    else console.log('node scripts/reactive-wall-probe.mjs [--smoke|--full] [--output path]. Synthetic source/provider only; no real model or media.');
  } catch { console.error(JSON.stringify({ status: 'failed', code: 'reactive_wall_probe_failed' })); process.exitCode = 1; }
}
