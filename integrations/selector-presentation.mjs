import { createHash } from 'node:crypto';
import { NativePresentationProvider } from './presentation-provider.mjs';
import { bootstrapSelector } from './selector-client.mjs';

const sourceText = input => `Public context:\n${input.publicContext}\nCurrent text:\n${input.target}`;
const sourceHash = input => createHash('sha256').update(sourceText(input)).digest('hex');

function identity(input, generation) {
  const keys = ['documentId', 'threadId', 'turnId', 'messageId'];
  if (keys.some(key => typeof input[key] !== 'string' || !input[key] || input[key].length > 256) ||
      !Number.isSafeInteger(generation) || generation < 0) throw Error('selector_source_identity');
  return JSON.stringify([...keys.map(key => input[key]), generation, 'assistant']);
}

export class SelectorFinalSource {
  constructor(generation) {
    this.generation = generation; this.config = { cooldownMs: 0 }; this.entries = new Map(); this.serial = 0;
  }
  revoke() {
    const previous = this.entries.get(this.current);
    if (previous) previous.revoked = true;
    this.current = null;
  }
  reject(reason) { this.revoke(); return { revoked: true, reason, checkpoint: null }; }
  update(input) {
    let id;
    try { id = identity(input, this.generation()); } catch { return this.reject('source_identity'); }
    if (typeof input.text !== 'string' || input.text.length > 64000 || !Number.isFinite(input.at) ||
        typeof input.completed !== 'boolean') return this.reject('source_limit');
    if (this.current && this.current !== id) this.revoke();
    if (!this.entries.has(id)) {
      if (this.entries.size >= 64) return this.reject('source_capacity');
      this.entries.set(id, { at: input.at, last: input.at, text: '', completed: false, emitted: false });
    }
    this.current = id; const entry = this.entries.get(id);
    if (entry.revoked) return this.reject('source_revoked');
    if (input.at < entry.last || !input.text.startsWith(entry.text) ||
        (entry.completed && (!input.completed || input.text !== entry.text))) return this.reject('source_corrected');
    entry.last = input.at; entry.text = input.text; entry.completed = input.completed;
    if (!input.completed || entry.emitted || !input.text.trim()) return { checkpoint: null };
    entry.emitted = true;
    return { checkpoint: { ...input, checkpointRevision: ++this.serial, sourceStart: 0,
      sourceEnd: input.text.length, previousEnd: 0, sourceText: input.text, target: input.text,
      textPrefix: input.text, sourceAt: entry.at, observedAt: entry.at, selectedAt: input.at } };
  }
}

export function selectorSource(state) {
  const value = state.conversation.snapshot(), messages = value.messages ?? [];
  const answer = messages.filter(message => message.role === 'assistant').at(-1);
  const user = messages.filter(message => message.role === 'user').at(-1);
  if (!answer || answer.truncated || answer.status !== 'completed' || !user || user.turn !== answer.turn ||
      (value.ownerTurn && value.ownerTurn !== answer.turn) || value.error || value.stopping) return null;
  const prior = messages.slice(0, messages.indexOf(answer)).filter(message => message.role === 'assistant');
  if (prior.some(message => message.truncated)) return null;
  const source = { documentId: state.channel.token, threadId: value.threadId, generation: value.generation,
    revision: value.revision, turnId: answer.turn, messageId: answer.id, role: 'assistant',
    target: answer.text, publicContext: prior.map(message => message.text).join('\n\n') };
  identity(source, source.generation);
  if (typeof source.target !== 'string' || !Number.isSafeInteger(source.revision)) return null;
  return source;
}

export class SelectorPresentationProvider {
  constructor({ fallback, client, snapshot, log = () => {} }) { Object.assign(this, { fallback, client, snapshot, log }); }
  close() { this.fallback.close?.(); void this.client.close().catch(() => {}); }
  async generate(exchange, signal, scene, callbacks) {
    const captured = this.snapshot(), key = JSON.stringify(captured);
    const current = () => !signal.aborted && callbacks.isCurrent() && JSON.stringify(this.snapshot()) === key;
    if (!captured || captured.target !== exchange.target || !current()) throw Error('selector_source_stale');
    const input = { publicContext: captured.publicContext, target: captured.target }; let result;
    try { result = await this.client.score(input, { signal }); }
    catch { if (!current()) throw Error('selector_source_stale'); }
    if (!current()) throw Error('selector_source_stale');
    if (result && result.sourceHash !== sourceHash(input)) throw Error('selector_source_hash');
    if (result?.selected?.length === 1) {
      const asset = this.client.library.catalog.find(value => value.id === result.selected[0]);
      if (!asset) throw Error('selector_asset_identity');
      const record = this.client.library.parseRecord(JSON.stringify({ base: 'reuse', assetId: asset.id, sha256: asset.sha256 }));
      if (!current()) throw Error('selector_source_stale');
      callbacks.onRecord(record); return;
    }
    if (captured.publicContext.length > 4096) throw Error('selector_fallback_context_capacity');
    if (!current()) throw Error('selector_source_stale');
    return this.fallback.generate({ ...exchange, target: captured.target, assistantText: captured.target,
      publicContext: captured.publicContext }, signal, scene, callbacks);
  }
}

async function readyForSession(start, signal) {
  if (signal?.aborted) throw Error('selector_start_cancelled');
  let cancelled = false, abort;
  const ready = Promise.resolve().then(start).then(async client => {
    if (cancelled || signal?.aborted) { await client.close(); throw Error('selector_start_cancelled'); }
    return client;
  });
  const stopped = new Promise((_, reject) => {
    abort = () => { cancelled = true; reject(Error('selector_start_cancelled')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  try { return await Promise.race([ready, stopped]); }
  finally { signal?.removeEventListener('abort', abort); }
}

export async function optionalSelectorPresentation({ state, host, runtime, env = process.env,
  signal, bootstrap = bootstrapSelector, fallbackFactory = () => new NativePresentationProvider({ host, runtime, timeoutMs: 30000, protocol: 'freeform' }) }) {
  const manifest = env.FISCH_EXPERIMENTAL_SELECTOR_MANIFEST;
  if (!manifest) return null;
  if (env.FISCH_PRESENTATION_PROTOCOL && env.FISCH_PRESENTATION_PROTOCOL !== 'freeform') {
    state.logs.push('Experimental local selector unavailable for this protocol; ordinary visual lane retained.'); return null;
  }
  let client;
  try {
    client = await readyForSession(() => bootstrap(manifest, { runtimeDirectory: env.FISCH_SELECTOR_RUNTIME_DIRECTORY, signal }), signal);
    const provider = new SelectorPresentationProvider({ fallback: fallbackFactory(), client, snapshot: () => selectorSource(state) });
    state.logs.push('Experimental local selector enabled: known false selections, 128-token limit; not validated for general dialogue.');
    return { provider, sampler: new SelectorFinalSource(() => state.conversation.snapshot().generation) };
  } catch {
    await client?.close().catch(() => {});
    state.logs.push(signal?.aborted ? 'Experimental local selector setup cancelled.' : 'Experimental local selector unavailable; ordinary visual lane retained for this session.'); return null;
  }
}
