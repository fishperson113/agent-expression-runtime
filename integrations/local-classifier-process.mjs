import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { parseClassifierPrediction } from './classifier-shadow.mjs';

const INPUT_LIMIT = 16384, OUTPUT_LIMIT = 65536;
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_./-]{1,128}$/.test(value);
function configuration(value) {
  for (const key of ['pythonExecutable', 'workerPath', 'modelDir', 'promptPath'])
    if (typeof value?.[key] !== 'string' || !isAbsolute(value[key]) || value[key].includes('\0')) throw Error('local_classifier_path');
  if (!identity(value.expectedModelId) || !identity(value.expectedRevision) || typeof value.projectWindow !== 'function') throw Error('local_classifier_config');
  const config = { startupTimeoutMs: 120000, requestTimeoutMs: 30000, ...value };
  if (![config.startupTimeoutMs, config.requestTimeoutMs].every(v => Number.isInteger(v) && v > 0 && v <= 300000)) throw Error('local_classifier_timeout');
  return Object.freeze(config);
}
function environment() {
  const names = ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'];
  const env = Object.fromEntries(names.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  return { ...env, PYTHONUNBUFFERED: '1', PYTHONNOUSERSITE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
    HF_HUB_DISABLE_TELEMETRY: '1', TOKENIZERS_PARALLELISM: 'false', USE_TF: '0' };
}
function packet(id, state) {
  const text = JSON.stringify({ id, state }, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value) || ['undefined', 'function', 'symbol', 'bigint'].includes(typeof value)) throw Error('local_classifier_input');
    return value;
  }) + '\n';
  if (Buffer.byteLength(text) > INPUT_LIMIT) throw Error('local_classifier_input_size');
  return text;
}
class LocalClassifier {
  #config; #child; #buffer = Buffer.alloc(0); #active; #started = false; #closed = false;
  #readyResolve; #readyReject; #exitResolve; #startupTimer; #exit; ready;
  constructor(options) {
    this.#config = configuration(options);
    this.ready = new Promise((resolve, reject) => { this.#readyResolve = resolve; this.#readyReject = reject; });
    void this.ready.catch(() => {});
    this.#exit = new Promise(resolve => { this.#exitResolve = resolve; });
    const c = this.#config;
    this.#child = spawn(c.pythonExecutable, ['-u', c.workerPath, '--model-dir', c.modelDir, '--prompt', c.promptPath],
      { shell: false, windowsHide: true, env: environment(), stdio: ['pipe', 'pipe', 'ignore'] });
    this.#child.on('error', () => this.#fail('local_classifier_process'));
    this.#child.on('close', () => { this.#fail('local_classifier_exit'); this.#exitResolve(); });
    this.#child.stdin.on('error', () => this.#fail('local_classifier_write'));
    this.#child.stdout.on('data', chunk => this.#read(chunk));
    this.#startupTimer = setTimeout(() => this.#fail('local_classifier_startup_timeout'), c.startupTimeoutMs);
  }
  #fail(code) {
    if (this.#closed) return;
    this.#closed = true; clearTimeout(this.#startupTimer); this.#readyReject(Error(code));
    this.#settle(Error(code)); this.#buffer = Buffer.alloc(0); this.#child.kill('SIGKILL');
  }
  #settle(error, prediction) {
    const active = this.#active;
    if (!active) return;
    this.#active = undefined; clearTimeout(active.timer); active.signal?.removeEventListener('abort', active.abort);
    if (!active.settled) { active.settled = true; if (error) active.reject(error); else active.resolve(prediction); }
  }
  #read(chunk) {
    if (this.#closed) return;
    if (this.#buffer.length + chunk.length > OUTPUT_LIMIT) { this.#fail('local_classifier_output_size'); return; }
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    let end;
    while (!this.#closed && (end = this.#buffer.indexOf(10)) >= 0) {
      const line = this.#buffer.subarray(0, end).toString('utf8'); this.#buffer = this.#buffer.subarray(end + 1);
      try { this.#message(JSON.parse(line)); } catch { this.#fail('local_classifier_protocol'); }
    }
  }
  #message(value) {
    const config = this.#config;
    if (!this.#started) {
      if (value?.ready !== true || value.modelId !== config.expectedModelId || value.modelRevision !== config.expectedRevision ||
          Object.keys(value).some(key => !['ready', 'modelId', 'modelRevision', 'loadMs'].includes(key)) ||
          value.loadMs !== undefined && (typeof value.loadMs !== 'number' || !Number.isFinite(value.loadMs) || value.loadMs < 0)) throw Error('ready');
      this.#started = true; clearTimeout(this.#startupTimer);
      this.#readyResolve(Object.freeze({ modelId: value.modelId, modelRevision: value.modelRevision })); return;
    }
    if (!this.#active || value?.id !== this.#active.id ||
        value.modelId !== undefined && value.modelId !== config.expectedModelId ||
        value.modelRevision !== undefined && value.modelRevision !== config.expectedRevision) throw Error('response');
    if (typeof value.error === 'string') { this.#settle(Error('local_classifier_worker_error')); return; }
    const text = JSON.stringify({ schemaVersion: 1, label: value.label, scores: value.scores });
    parseClassifierPrediction(text); this.#settle(null, text);
  }
  classify(window, signal) {
    if (this.#closed) return Promise.reject(Error('local_classifier_closed'));
    if (!this.#started) return Promise.reject(Error('local_classifier_not_ready'));
    if (this.#active) return Promise.reject(Error('local_classifier_busy'));
    if (signal?.aborted) return Promise.reject(Error('local_classifier_aborted'));
    let id, text;
    try {
      const state = this.#config.projectWindow(window);
      if (typeof state?.then === 'function') { void Promise.resolve(state).catch(() => {}); throw Error('async_projection'); }
      id = randomUUID(); text = packet(id, state);
    }
    catch { return Promise.reject(Error('local_classifier_input')); }
    if (signal?.aborted) return Promise.reject(Error('local_classifier_aborted'));
    return new Promise((resolve, reject) => {
      const active = { id, resolve, reject, signal, settled: false, abort: () => {
        if (!active.settled) { active.settled = true; reject(Error('local_classifier_aborted')); }
      } };
      this.#active = active; signal?.addEventListener('abort', active.abort, { once: true });
      active.timer = setTimeout(() => this.#fail('local_classifier_request_timeout'), this.#config.requestTimeoutMs);
      if (active.settled || signal?.aborted) { this.#settle(Error('local_classifier_aborted')); return; }
      this.#child.stdin.write(text, error => { if (error) this.#fail('local_classifier_write'); });
    });
  }
  close() { this.#fail('local_classifier_closed'); return this.#exit; }
  get busy() { return !!this.#active; }
}
export function createLocalClassifier(options) { return new LocalClassifier(options); }
