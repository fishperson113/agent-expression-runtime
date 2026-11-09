import { freezeReactiveReceipt } from './reactive-receipt.mjs';
import { ReactiveProviderError } from './reactive-provider.mjs';
import { freezeReactiveCandidate } from './reactive-window.mjs';

function captureToken(value) {
  try {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).length !== 2 || typeof fields.runId?.value !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(fields.runId.value) || !Number.isSafeInteger(fields.generation?.value) || fields.generation.value < 0) return null;
    return Object.freeze({ runId: fields.runId.value, generation: fields.generation.value });
  } catch { return null; }
}
const controlled = new Set(['turn/start', 'turn/steer', 'thread/start', 'thread/resume', 'thread/fork', 'turn/interrupt']);
export class LiveReactiveBroker {
  closed = false; browserUnavailable = false; waiters = new Set(); polling = false; draining = false; active; uncertain = false; paused = false;
  providerReceipts = []; queue = []; pending = new Map(); turns = new Set(); completed = new Set(); receipts = new Set(); requests = new Set();
  constructor({ page, provider = null, output, forward, reject, log = () => {}, evaluateTimeoutMs = 10000 }) {
    if (!Number.isInteger(evaluateTimeoutMs) || evaluateTimeoutMs < 1 || evaluateTimeoutMs > 10000) throw Error('reactive_timeout_invalid');
    Object.assign(this, { page, provider, output, forward, reject, log, evaluateTimeoutMs });
  }
  evaluate(fn, arg) {
    if (this.closed || this.browserUnavailable) return Promise.reject(Error('reactive_browser_unavailable'));
    if (this.waiters.size >= 4) { this.browserFailed(); return Promise.reject(Error('reactive_browser_unavailable')); }
    return new Promise((resolve, reject) => {
      const owned = { reject: error => settle(reject, error) };
      const settle = (callback, value) => {
        if (!this.waiters.delete(owned)) return;
        clearTimeout(owned.timer); callback(value);
      };
      owned.timer = setTimeout(() => this.browserFailed(), this.evaluateTimeoutMs); this.waiters.add(owned);
      void Promise.resolve().then(() => {
        if (this.waiters.has(owned)) return this.page.evaluate(fn, arg);
      }).then(value => settle(resolve, value), () => { if (this.waiters.has(owned)) this.browserFailed(); });
    });
  }
  rejectEvaluations(code) {
    for (const owned of [...this.waiters]) owned.reject(Error(code));
  }
  browserFailed() {
    if (this.closed || this.browserUnavailable) return;
    this.browserUnavailable = true; this.paused = true; this.uncertain = true;
    clearTimeout(this.active?.timer); if (this.active) this.active.terminal = true;
    this.rejectEvaluations('reactive_browser_unavailable'); this.log('reactive_browser_unavailable');
  }
  busy() { return !!(this.draining || this.queue.length || this.pending.size || this.turns.size || this.output.turn || this.output.selection !== undefined); }
  client(message) {
    if (!controlled.has(message.method)) return true;
    if (this.closed || this.browserUnavailable || this.queue.length + Number(this.draining) >= 8 || this.pending.size >= 64 || message.id === undefined || this.receipts.has(message.id)) {
      this.rejectInput(message, 'reactive_user_unavailable', false); return false;
    }
    if (message.method === 'turn/steer' && (!this.output.turn || message.params?.threadId !== this.output.thread ||
      message.params?.expectedTurnId !== this.output.turn)) { this.rejectInput(message, 'reactive_steer_invalid', false); return false; }
    this.receipts.add(message.id); if (this.receipts.size > 64) this.receipts.delete(this.receipts.values().next().value);
    this.pending.set(message.id, { method: message.method, threadId: message.params?.threadId });
    this.queue.push(message); void this.drain(); return false;
  }
  rejectInput(message, code, remove = true) {
    if (remove) this.pending.delete(message.id);
    this.reject(message, { code: -32000, message: code }); this.log(code);
  }
  async drain() {
    if (this.draining) return; this.draining = true;
    try {
      while (!this.closed && this.queue.length) {
        const message = this.queue.shift();
        try {
          await this.evaluate(() => window.fischLive.reactiveUserIntent());
          if (this.closed || this.browserUnavailable) { this.rejectInput(message, 'reactive_user_closed'); continue; }
          if (message.method === 'turn/steer' && (message.params?.threadId !== this.output.thread ||
            message.params?.expectedTurnId !== this.output.turn)) throw Error('steer_changed');
          try { this.forward(message); } catch {
            this.rejectInput(message, 'reactive_user_forward_unknown', false);
          }
        } catch { this.rejectInput(message, 'reactive_user_barrier_failed'); }
      }
    } finally { this.draining = false; }
  }
  trackTurn(id) {
    if (this.turns.size < 64) this.turns.add(id);
    else { this.paused = true; this.log('reactive_user_turn_limit'); }
  }
  event(message) {
    if (this.closed) return;
    const pending = this.pending.get(message.id), { method, params = {} } = message;
    if (pending && (message.result || message.error)) {
      this.pending.delete(message.id);
      if (['thread/start', 'thread/resume', 'thread/fork'].includes(pending.method) && message.result?.thread?.id) this.turns.clear();
      const turn = message.result?.turn;
      if (pending.method === 'turn/start' && !message.error && turn?.status === 'inProgress' &&
        pending.threadId === this.output.thread && turn.id === this.output.turn && !this.completed.has(turn.id)) this.trackTurn(turn.id);
    }
    if (method === 'turn/started' && params.threadId === this.output.thread && params.turn?.id && !this.completed.has(params.turn.id)) this.trackTurn(params.turn.id);
    if (method === 'turn/completed' && params.turn?.id) {
      this.turns.delete(params.turn.id); this.completed.add(params.turn.id);
      if (this.completed.size > 64) this.completed.delete(this.completed.values().next().value);
    }
  }
  async poll(activity, entries = []) {
    if (this.closed || this.browserUnavailable || this.polling) return; this.polling = true;
    try {
      const available = !!this.provider && !this.paused && !this.uncertain;
      const queuedReceipts = this.providerReceipts.splice(0, 8);
      const polled = await this.evaluate(({ activity, entries, busy, available, take, receipts }) => {
        const api = window.fischLive;
        for (const item of receipts) { try {
          const pending = api.recordProviderReceipt?.(item.token, item.receipt);
          if (pending !== undefined) void Promise.resolve(pending).catch(() => {});
        } catch {} }
        api.activity(activity);
        for (const text of entries) api.logActivity?.(text);
        api.configureReactive(available); api.setReactiveUserBusy(busy);
        let token = null; try { token = api.recordingCaptureToken?.() ?? null; } catch {}
        return { candidate: take ? api.takeReactiveRequest() : null, captureToken: token };
      }, { activity, entries, busy: this.busy(), available, take: available && !this.active && !this.busy(), receipts: queuedReceipts });
      const candidate = polled?.candidate, token = captureToken(polled?.captureToken);
      if (!this.closed && !this.browserUnavailable && candidate && !this.active && !this.busy()) this.start(candidate, token);
      else if (!this.closed && !this.browserUnavailable && candidate) await this.deliver(candidate.request.requestId, null);
    } catch { this.paused = true; this.log('reactive_browser_unavailable'); }
    finally { this.polling = false; }
  }
  start(candidate, token = null) {
    try { candidate = freezeReactiveCandidate(candidate); } catch {
      const rejected = candidate?.request?.requestId;
      const id = typeof rejected === 'string' && rejected.length <= 64 ? rejected : '';
      void this.deliver(id, null).catch(() => { this.paused = true; }); return;
    }
    const id = candidate.request.requestId;
    if (this.requests.has(id) || this.requests.size >= 256) {
      if (this.requests.size >= 256) this.paused = true;
      this.log('reactive_request_rejected'); void this.deliver(id, null).catch(() => { this.paused = true; }); return;
    }
    this.requests.add(id);
    const owned = { id, captureToken: token, receiptSeen: false, controller: new AbortController(), terminal: false };
    this.active = owned; void this.authorize(owned, candidate);
  }
  receipt(owned, value) {
    if (this.closed || this.browserUnavailable || owned.receiptSeen || !owned.captureToken) return;
    try {
      const receipt = freezeReactiveReceipt(value);
      if (receipt.requestId !== owned.id) return;
      owned.receiptSeen = true;
      if (this.providerReceipts.length < 8) this.providerReceipts.push({ token: owned.captureToken, receipt });
    } catch {}
  }
  async authorize(owned, candidate) {
    let allowed;
    try {
      const result = await this.evaluate(async id => {
        const api = window.fischLive, allowed = await api.authorizeReactiveRequest(id);
        let token = null; try { token = api.recordingCaptureToken?.() ?? null; } catch {}
        return { allowed, captureToken: token };
      }, owned.id);
      allowed = result?.allowed;
      const current = captureToken(result?.captureToken);
      if (!current || !owned.captureToken || current.runId !== owned.captureToken.runId || current.generation !== owned.captureToken.generation) owned.captureToken = null;
    }
    catch { this.paused = true; this.log('reactive_authorization_failed'); }
    if (this.closed || this.browserUnavailable || this.active !== owned) return;
    if (allowed !== true || this.busy()) { owned.terminal = true; await this.finishFailure(owned); return; }
    owned.timer = setTimeout(() => { if (this.closed || this.browserUnavailable || this.active !== owned) return;
      owned.terminal = true; this.uncertain = true; owned.controller.abort(); this.log('reactive_transport_timeout');
      void this.fail(owned.id);
    }, 30000);
    void Promise.resolve().then(() => {
      if (!this.closed && !this.browserUnavailable && this.active === owned) return this.provider.decide(candidate.observationWindow, owned.controller.signal,
        owned.captureToken ? value => this.receipt(owned, value) : undefined);
    })
      .then(value => this.finish(owned, value)).catch(error => this.failed(owned, error));
  }
  async deliver(id, data) {
    return this.evaluate(({ id, data }) => window.fischLive.deliverReactiveDecision(id, data), { id, data });
  }
  async fail(id) {
    try { await this.evaluate(id => window.fischLive.failReactiveDecision(id), id); }
    catch { this.log('reactive_browser_unavailable'); }
  }
  async finish(owned, value) {
    if (this.closed || this.browserUnavailable || this.active !== owned || owned.terminal) return;
    clearTimeout(owned.timer); owned.terminal = true;
    try { await this.deliver(owned.id, value); if (this.active === owned) this.active = undefined; }
    catch { this.uncertain = true; this.log('reactive_delivery_unknown'); }
  }
  async failed(owned, error) {
    if (this.closed || this.browserUnavailable || this.active !== owned || owned.terminal) return;
    clearTimeout(owned.timer); owned.terminal = true;
    const settled = error instanceof ReactiveProviderError && error.transportSettled === true;
    if (error instanceof ReactiveProviderError && error.code === 'reactive_budget_denied') this.paused = true;
    if (settled) { this.log('reactive_decision_failed'); await this.finishFailure(owned); }
    else { this.uncertain = true; this.log('reactive_transport_unknown'); await this.fail(owned.id); }
  }
  async finishFailure(owned) {
    try { await this.deliver(owned.id, null); if (this.active === owned) this.active = undefined; }
    catch { this.uncertain = true; this.log('reactive_delivery_unknown'); }
  }
  close() {
    this.closed = true; this.rejectEvaluations('reactive_user_closed'); clearTimeout(this.active?.timer); this.active?.controller.abort();
    for (const message of this.queue.splice(0)) this.rejectInput(message, 'reactive_user_closed');
    this.active = undefined; this.providerReceipts = []; this.pending.clear(); this.turns.clear(); this.completed.clear(); this.receipts.clear(); this.requests.clear();
  }
}
