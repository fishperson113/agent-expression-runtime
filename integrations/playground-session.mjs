import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import Ajv from 'ajv';

const protocol = createRequire(import.meta.url)('../src/contracts/protocol.schema.json');
const valid = new Ajv({ strict: false }).compile(protocol);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copy = value => structuredClone(value);
const phases = ['body', 'baseline'];

function commands(scene) {
  const { brightness, pointSize, dispersion } = scene.style;
  return [{ phase: 'body', kind: 'program', track: 'body', policy: 'replace', body:
    { type: 'live', program: program(scene), configuration: { controls: [], poses: [], lifetimeMs: 60000 } } },
  { phase: 'baseline', kind: 'state', body: { brightness, pointSize, dispersion, rise: 0, advance: 0,
    spread: 1, grow: 1, durationMs: 600, easing: 'smoothstep' } }];
}

function program(scene) {
  return { type: 'parallel', children: [
    { type: 'assemble', parts: copy(scene.parts), durationMs: 600 },
    { type: 'style', ...scene.style, durationMs: 600 },
    { type: 'flow', ...scene.flow, durationMs: 600 },
    { type: 'shapeQuality', rise: 0, advance: 0, grow: 1, spread: 1, path: 'spoke', effort: { flow: 0 }, durationMs: 600 }
  ] };
}

function record(input) {
  let scene, bytes;
  try { scene = copy(input); bytes = Buffer.byteLength(JSON.stringify(scene), 'utf8'); }
  catch { throw Error('playground_scene'); }
  if (bytes > 32768) throw Error('playground_scene_bytes');
  if (!scene || typeof scene !== 'object' || Array.isArray(scene) ||
      Object.keys(scene).some(key => !['parts', 'style', 'flow', 'goal'].includes(key))) throw Error('playground_scene');
  if (scene.goal !== undefined && (typeof scene.goal !== 'string' || scene.goal.length > 160 || /[\x00-\x1f]/.test(scene.goal))) throw Error('playground_goal');
  for (const [key, fields] of [['style', ['color', 'pointSize', 'brightness', 'dispersion']], ['flow', ['field', 'strength']]]) {
    if (!scene[key] || Object.keys(scene[key]).length !== fields.length || fields.some(field => !Object.hasOwn(scene[key], field))) throw Error('playground_scene');
  }
  const body = program(scene);
  if (!valid({ v: 1, epoch: 'validation', seq: 0, kind: 'program', track: 'body', policy: 'replace', body })) throw Error('playground_scene');
  const { phase, ...state } = commands(scene)[1];
  if (!valid({ v: 1, epoch: 'validation', seq: 1, ...state })) throw Error('playground_scene');
  for (const { phase, ...command } of commands(scene))
    if (Buffer.byteLength(JSON.stringify({ v: 1, epoch: '00000000-0000-0000-0000-000000000000', seq: Number.MAX_SAFE_INTEGER, ...command })) > 32768) throw Error('playground_command_bytes');
  if (new Set(scene.parts.map(part => part.id)).size !== scene.parts.length) throw Error('playground_scene');
  return { scene, bytes };
}

export class PlaygroundSession {
  #session; #revision = 0; #history = []; #pending = null; #closed = false;
  #epochs = new Set(); #epoch; #lastSeq = -1;
  constructor(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.length || sessionId.length > 128) throw Error('playground_session');
    this.#session = sessionId;
  }
  #transaction(id) {
    if (this.#closed) throw Error('playground_closed');
    if (!this.#pending || id !== this.#pending.id) throw Error('playground_transaction');
    return this.#pending;
  }
  propose({ sessionId, expectedRevision, operation, scene, ...extra }) {
    if (this.#closed) throw Error('playground_closed');
    if (sessionId !== this.#session) throw Error('playground_session');
    if (expectedRevision !== this.#revision) throw Error('playground_revision');
    if (this.#pending) throw Error('playground_busy');
    if (Object.keys(extra).length) throw Error('playground_arguments');
    const history = this.#history.slice(); let target;
    if (['create', 'remix'].includes(operation)) {
      if ((operation === 'create') !== (history.length === 0)) throw Error('playground_operation');
      target = record(scene); history.push(target);
      if (history.length > 12) history.splice(1, history.length - 12);
    } else {
      if (scene !== undefined || !['undo', 'reset'].includes(operation) || !history.length) throw Error('playground_operation');
      if (operation === 'undo') { if (history.length < 2) throw Error('playground_undo_empty'); history.pop(); }
      else history.splice(1);
      target = history.at(-1);
    }
    const retained = new Set([...this.#history, ...history]);
    if ([...retained].reduce((sum, value) => sum + value.bytes, 0) > 131072) throw Error('playground_memory');
    this.#pending = { id: randomUUID(), history, operation, stage: 'proposed', receipts: {}, applied: new Set(), completed: new Set(), failed: false };
    return { transaction: this.#pending.id, baseRevision: this.#revision, commands: commands(target.scene) };
  }
  admit(transaction, phase, receipt, authoritativeRejection = false) {
    const pending = this.#transaction(transaction);
    if (!phases.includes(phase)) throw Error('playground_phase');
    if (phase === 'baseline' && !pending.receipts.body) { pending.failed = true; throw Error('playground_order'); }
    if ((receipt?.session !== undefined || ['accepted', 'pending'].includes(receipt?.status)) && receipt?.session !== this.#session) throw Error('playground_receipt');
    if (receipt?.status === 'rejected') {
      if (authoritativeRejection === true && !pending.failed && phase === 'body' && !Object.keys(pending.receipts).length) this.#pending = null;
      else pending.failed = true;
      return;
    }
    if (receipt?.status === 'pending') { if (!pending.failed && !Object.keys(pending.receipts).length) pending.stage = 'pending'; return; }
    if (receipt?.status !== 'accepted' || !uuid.test(receipt.epoch) || !Number.isSafeInteger(receipt.seq) || receipt.seq < 0) throw Error('playground_receipt');
    const previous = pending.receipts[phase], body = pending.receipts.body;
    if (previous) {
      if (previous.epoch !== receipt.epoch || previous.seq !== receipt.seq) { pending.failed = true; throw Error('playground_receipt'); }
      return;
    }
    if (phase === 'baseline' && (!body || body.epoch !== receipt.epoch || body.seq === receipt.seq)) { pending.failed = true; throw Error('playground_receipt'); }
    if (receipt.epoch === this.#epoch ? receipt.seq <= this.#lastSeq : this.#epochs.has(receipt.epoch)) {
      if (Object.keys(pending.receipts).length) pending.failed = true;
      throw Error('playground_receipt');
    }
    if (!this.#epochs.has(receipt.epoch) && this.#epochs.size >= 64) throw Error('playground_epoch_limit');
    this.#epochs.add(receipt.epoch); this.#epoch = receipt.epoch; this.#lastSeq = receipt.seq;
    pending.receipts[phase] = { epoch: receipt.epoch, seq: receipt.seq };
    if (!pending.failed) pending.stage = 'admitted';
  }
  uncertain(transaction) { this.#transaction(transaction).failed = true; }
  feedback(event) {
    const pending = this.#pending;
    if (!pending || event?.session !== this.#session) return false;
    const phase = phases.find(key => pending.receipts[key]?.epoch === event?.epoch && pending.receipts[key]?.seq === event?.seq);
    if (!phase) return false;
    if (event.status === 'applied') { pending.applied.add(phase); return true; }
    if (event.status === 'completed') {
      if (!pending.applied.has(phase)) { pending.failed = true; return false; }
      pending.completed.add(phase);
      if (pending.completed.size === 2 && !pending.failed) { this.#history = pending.history; this.#revision++; this.#pending = null; }
      return true;
    }
    if (event.status === 'cancelled' || event.status === 'rejected') { pending.failed = true; return true; }
    return false;
  }
  current() { return this.#history.length ? copy(this.#history.at(-1).scene) : null; }
  status() {
    return { revision: this.#revision, scenes: this.#history.length, closed: this.#closed,
      bytes: [...new Set([...this.#history, ...(this.#pending?.history ?? [])])].reduce((sum, value) => sum + value.bytes, 0),
      pending: this.#pending ? { transaction: this.#pending.id, stage: this.#pending.failed ? 'desynchronized' : this.#pending.stage } : null };
  }
  dispose() { this.#history = []; this.#pending = null; this.#session = ''; this.#epochs.clear(); this.#closed = true; }
}
