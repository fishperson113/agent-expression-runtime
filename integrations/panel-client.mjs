import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 || Number.isSafeInteger(value);
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const bounded = (value, limit) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= limit;
const approvalMethods = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']);
const fail = code => Error(code);
const fileApproval = method => method === 'item/fileChange/requestApproval';
function reviewFingerprint(item) {
  if (item?.type !== 'fileChange' || item.truncated || !bounded(item, 16384) || !Array.isArray(item.changes) || !item.changes.length) return null;
  const changes = [];
  for (const c of item.changes) {
    if (typeof c?.path !== 'string' || !c.path || typeof c.diff !== 'string' || !['add', 'delete', 'update'].includes(c.kind?.type) || c.kind.move_path != null && typeof c.kind.move_path !== 'string') return null;
    changes.push([c.path, c.kind.type, c.kind.move_path ?? null, c.diff]);
  }
  return JSON.stringify(changes);
}

function requestControl(message, item) {
  const p = message.params;
  if (!p || ![p.threadId, p.turnId, p.itemId].every(label) || !bounded(p, 16384)) return null;
  const identity = { type: 'request', id: message.id, method: message.method, threadId: p.threadId, turnId: p.turnId, itemId: p.itemId };
  if (approvalMethods.has(message.method)) {
    const command = message.method.includes('commandExecution');
    const canAccept = command ? typeof p.command === 'string' && !!p.command && typeof p.cwd === 'string' && !!p.cwd && (!p.kind || p.kind === 'command') : p.grantRoot == null && reviewFingerprint(item) !== null;
    return { ...identity, details: structuredClone(p), choices: canAccept ? ['accept', 'decline', 'cancel'] : ['decline', 'cancel'] };
  }
  if (message.method !== 'item/tool/requestUserInput' || typeof p.isBlocking !== 'boolean' || !Array.isArray(p.questions) || p.questions.length < 1 || p.questions.length > 8) return null;
  const ids = new Set();
  for (const q of p.questions) {
    if (!q || !label(q.id) || ['__proto__', 'constructor', 'prototype'].includes(q.id) || ids.has(q.id) || q.isSecret || typeof q.header !== 'string' || typeof q.question !== 'string') return null;
    if (q.options != null && (!Array.isArray(q.options) || q.options.length > 16 || q.options.some(o => typeof o?.label !== 'string' || typeof o?.description !== 'string'))) return null;
    ids.add(q.id);
  }
  return { ...identity, details: structuredClone(p), choices: [] };
}

function answerResult(control, value) {
  if (approvalMethods.has(control.method)) {
    if (Object.keys(value).some(key => !['id', 'decision'].includes(key)) || !control.choices.includes(value.decision)) throw fail('panel_decision_invalid');
    return { decision: value.decision };
  }
  const answers = value.answers;
  if (Object.keys(value).some(key => !['id', 'answers'].includes(key)) || !answers || typeof answers !== 'object' || Array.isArray(answers) || !bounded(answers, 16384)) throw fail('panel_answers_invalid');
  const questions = control.details.questions;
  if (Object.keys(answers).length !== questions.length) throw fail('panel_answers_invalid');
  for (const q of questions) {
    const answer = Object.hasOwn(answers, q.id) && answers[q.id];
    if (!answer || Object.keys(answer).join() !== 'answers' || !Array.isArray(answer.answers) || answer.answers.length < 1 || answer.answers.length > 8 || answer.answers.some(s => typeof s !== 'string' || s.length > 4000)) throw fail('panel_answers_invalid');
  }
  return { answers: structuredClone(answers) };
}

export class PanelProtocol {
  pending = new Map(); controls = new Map(); reviews = new Map(); seen = new Set(); terminal = new Set(); items = new Map(); threadId; turnId; closed = false; serial = 0;
  prefix = 'panel:' + randomBytes(12).toString('hex') + ':';
  constructor({ write, onControl = () => {}, onFailure = () => {} }) { Object.assign(this, { write, onControl, onFailure }); }
  emit(value) { this.onControl(structuredClone(value)); }
  request(method, params) {
    if (this.closed || this.pending.size >= 8) return Promise.reject(fail('panel_rpc_unavailable'));
    const id = this.prefix + ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(fail('panel_rpc_timeout')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(fail('panel_write_unknown')); }
    });
  }
  async initialize(cwd, resumeThreadId) {
    if (resumeThreadId !== undefined && !label(resumeThreadId)) throw fail('panel_resume_invalid');
    await this.request('initialize', { clientInfo: { name: 'fisch_panel', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.write({ method: 'initialized', params: {} });
    const reply = await this.request(resumeThreadId === undefined ? 'thread/start' : 'thread/resume', resumeThreadId === undefined ? { cwd } : { threadId: resumeThreadId, cwd });
    if (!label(reply?.thread?.id) || resumeThreadId !== undefined && reply.thread.id !== resumeThreadId) throw fail('panel_thread_invalid');
    this.threadId = reply.thread.id;
    return this.threadId;
  }
  receive(message) {
    if (this.closed) return;
    if (message.method && message.id !== undefined) return this.serverRequest(message);
    if (message.method) return this.notification(message);
    const entry = this.pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer); this.pending.delete(message.id);
    message.error ? entry.reject(Object.assign(fail('panel_rpc_rejected'), { rpcError: bounded(message.error, 65536) ? structuredClone(message.error) : { code: message.error.code, message: 'panel_rpc_error_details_omitted' } })) : entry.resolve(message.result);
  }
  serverRequest(message) {
    if (!validId(message.id)) throw fail('panel_request_invalid');
    if (this.seen.has(message.id)) throw fail('panel_request_duplicate');
    if (this.seen.size >= 256) throw fail('panel_request_history_full');
    this.seen.add(message.id);
    const control = requestControl(message, this.items.get(message.params?.itemId));
    if (!control || control.threadId !== this.threadId || control.turnId !== this.turnId || this.controls.size >= 16) {
      this.write({ id: message.id, error: { code: -32601, message: 'Panel request unsupported or unavailable; no approval granted.' } });
      this.emit({ type: 'unsupported', id: message.id, method: String(message.method).slice(0, 128), reason: 'unsupported_or_unavailable' }); return;
    }
    this.controls.set(message.id, control);
    if (fileApproval(control.method)) this.reviews.set(control.id, { fingerprint: reviewFingerprint(this.items.get(control.itemId)), revoked: false });
    this.emit(control);
  }
  updateEligibility() {
    for (const [id, review] of this.reviews) {
      const control = this.controls.get(id), fingerprint = reviewFingerprint(this.items.get(control.itemId));
      if (review.fingerprint !== null && review.fingerprint !== fingerprint) review.revoked = true;
      if (review.fingerprint === null && !review.revoked && fingerprint !== null) review.fingerprint = fingerprint;
      const accept = !review.revoked && fingerprint !== null && control.details.grantRoot == null;
      const choices = accept ? ['accept', 'decline', 'cancel'] : ['decline', 'cancel'];
      if (choices.join() === control.choices.join()) continue;
      control.choices = choices;
      this.emit({ type: 'eligibility', id, threadId: control.threadId, turnId: control.turnId, itemId: control.itemId, choices });
    }
  }
  respond(value) {
    if (this.closed || !value || !validId(value.id)) throw fail('panel_response_unavailable');
    const control = this.controls.get(value.id);
    if (!control || control.threadId !== this.threadId || control.turnId !== this.turnId) throw fail('panel_response_stale');
    this.updateEligibility();
    const result = answerResult(control, value);
    this.controls.delete(value.id); this.reviews.delete(value.id);
    try { this.write({ id: value.id, result }); }
    catch {
      try { this.emit({ type: 'resolved', id: value.id, threadId: control.threadId, turnId: control.turnId, reason: 'response_unknown' }); }
      finally { try { this.close(); } finally { this.onFailure('panel_response_unknown'); } }
      throw fail('panel_response_unknown');
    }
    this.emit({ type: 'resolved', id: value.id, threadId: control.threadId, turnId: control.turnId, reason: 'submitted' });
    return { status: 'submitted' };
  }
  settleControls(reason, predicate = () => true) {
    for (const [id, control] of this.controls) if (predicate(control)) {
      this.controls.delete(id); this.reviews.delete(id); this.emit({ type: 'resolved', id, threadId: control.threadId, turnId: control.turnId, reason });
    }
  }
  notification(message) {
    const p = message.params ?? {};
    if (p.threadId !== this.threadId) return;
    if (message.method === 'serverRequest/resolved') return this.settleControls('server_resolved', control => control.id === p.requestId);
    if (message.method === 'turn/started' && label(p.turn?.id) && !this.terminal.has(p.turn.id) && p.turn.id !== this.turnId) {
      this.settleControls('owner_changed'); this.items.clear(); this.turnId = p.turn.id;
    }
    if (message.method === 'turn/completed' && label(p.turn?.id)) {
      this.terminal.add(p.turn.id); if (this.terminal.size > 64) this.terminal.delete(this.terminal.values().next().value);
      if (p.turn.id === this.turnId) { this.settleControls('turn_terminal'); this.items.clear(); this.turnId = undefined; }
    }
    if (!['item/started', 'item/completed'].includes(message.method) || p.turnId !== this.turnId || !label(p.item?.id)) return;
    if (!['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch'].includes(p.item.type)) {
      this.items.delete(p.item.id); this.updateEligibility(); return;
    }
    const item = bounded(p.item, 16384) ? structuredClone(p.item) : { id: p.item.id, type: p.item.type, status: p.item.status, truncated: true };
    this.items.set(item.id, item); if (this.items.size > 32) this.items.delete(this.items.keys().next().value);
    this.emit({ type: 'tool', phase: message.method === 'item/started' ? 'started' : 'completed', threadId: p.threadId, turnId: p.turnId, item });
    this.updateEligibility();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(fail('panel_closed')); }
    this.pending.clear();
    try { this.settleControls('closed'); } finally { this.controls.clear(); this.reviews.clear(); this.seen.clear(); this.terminal.clear(); this.items.clear(); }
  }
}

export async function openPanelClient({ url, token, cwd, resumeThreadId, onControl, onFailure = () => {} }) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password || typeof token !== 'string' || !token || typeof cwd !== 'string' || !cwd) throw fail('panel_configuration');
  if (resumeThreadId !== undefined && !label(resumeThreadId)) throw fail('panel_resume_invalid');
  const socket = new WebSocket(url, { headers: { Authorization: 'Bearer ' + token }, maxPayload: 1048576 });
  let intentional = false, failed = false;
  const protocol = new PanelProtocol({ write: message => {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1048576) throw fail('panel_socket_unavailable');
    socket.send(JSON.stringify(message));
  }, onControl, onFailure: () => failure() });
  const failure = () => {
    if (intentional || failed) return; failed = true;
    try { protocol.close(); } catch { /* A failing projection cannot retain transport authority. */ }
    socket.terminate(); onFailure('panel_connection_lost');
  };
  socket.on('message', bytes => { try { protocol.receive(JSON.parse(bytes.toString())); } catch { failure(); } });
  socket.on('error', failure); socket.on('close', failure);
  const close = () => { intentional = true; try { protocol.close(); } finally { socket.terminate(); } };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(fail('panel_connect_timeout')), 10000);
      socket.once('open', () => { clearTimeout(timer); resolve(); });
      socket.once('error', () => { clearTimeout(timer); reject(fail('panel_connect_failed')); });
      socket.once('close', () => { clearTimeout(timer); reject(fail('panel_connect_closed')); });
    });
    const threadId = await protocol.initialize(cwd, resumeThreadId);
    return { threadId, respond: value => protocol.respond(value), close };
  } catch (error) { try { close(); } catch {} throw error; }
}
