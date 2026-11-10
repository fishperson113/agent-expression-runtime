import { PlaygroundSession } from './playground-session.mjs';

const statuses = ['accepted', 'applied', 'completed', 'cancelled', 'rejected'];
const sameReceipt = (a, b) => a?.session === b?.session && a?.epoch === b?.epoch && a?.seq === b?.seq;
function argumentsFor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['operation', 'expectedRevision', 'scene'].includes(key)) ||
      !['create', 'remix', 'undo', 'reset', 'recover'].includes(value.operation) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 ||
      (['create', 'remix'].includes(value.operation) ? !Object.hasOwn(value, 'scene') : Object.hasOwn(value, 'scene'))) throw Error('playground_arguments');
  return structuredClone(value);
}
function sessionValue(value) {
  if (!value || typeof value.id !== 'string' || !value.id.length || value.id.length > 128 || typeof value.epoch !== 'string' || !value.epoch.length || value.epoch.length > 128) throw Error('playground_session');
  return { id: value.id, epoch: value.epoch };
}

class Controller {
  constructor(options) {
    if (['currentSession', 'send', 'subscribe', 'invalidate'].some(key => typeof options?.[key] !== 'function')) throw Error('playground_options');
    this.options = options; this.timeoutMs = options.timeoutMs ?? 3000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 30000) throw Error('playground_timeout');
    this.generation = 0; this.required = false; this.closed = false;
  }
  live(job) {
    if (this.job !== job || job.done || this.closed) return false;
    if (performance.now() >= job.deadline) { this.fail(job, job.waitCode ?? 'playground_timeout'); return false; }
    return true;
  }
  state(includeScene = false) {
    const state = { ...(this.journal?.status() ?? { revision: 0, scenes: 0, bytes: 0, pending: null }), closed: this.closed, recoveryRequired: this.required };
    if (includeScene) state.scene = this.journal?.current() ?? null;
    return state;
  }
  detach() {
    this.generation++; const stop = this.stop; this.stop = undefined;
    try { stop?.(); } catch {}
  }
  requireRecovery(owner = this.session) {
    if (!this.recoveryOwner && owner) this.recoveryOwner = { ...owner };
    this.required = true;
  }
  finish(job, status, code) {
    if (this.job !== job || job.done) return;
    job.done = true; clearTimeout(job.timer);
    job.dispatch?.resolve(null); job.dispatch = undefined;
    const admission = job.admission; job.admission = undefined; admission?.resolve(null);
    if (status === 'uncertain') {
      this.requireRecovery();
      try { if (job.transaction) this.journal?.uncertain(job.transaction); } catch {}
      this.detach();
    }
    this.job = undefined;
    job.resolve({ status, ...this.state(), ...(code ? { code } : {}),
      ...(status === 'uncertain' ? { waitingFor: job.stage, elapsedMs: Math.round(performance.now() - job.startedAt) } : {}) });
  }
  fail(job, code) { this.finish(job, 'uncertain', code); }
  bind(next) {
    if (this.session && (next.id !== this.session.id || next.epoch !== this.session.epoch)) {
      this.requireRecovery(this.session); this.detach(); this.journal?.dispose(); this.session = next;
      if (this.job) this.fail(this.job, 'playground_session_changed');
      return false;
    }
    if (!this.session) { this.session = next; this.journal = new PlaygroundSession(next.id); }
    return true;
  }
  async stream(job) {
    if (this.stop) return;
    const generation = this.generation;
    const stop = await this.options.subscribe({ ...this.session }, event => this.receive(event, generation), () => {
      if (generation !== this.generation) return;
      this.requireRecovery(); this.detach(); if (this.job) this.fail(this.job, 'playground_stream_lost');
    });
    if (!this.live(job) || generation !== this.generation) { try { stop?.(); } catch {} return; }
    if (typeof stop !== 'function') throw Error('playground_subscription');
    this.stop = stop;
  }
  receive(event, generation) {
    const job = this.job;
    if (!job || !this.live(job) || generation !== this.generation || event?.session !== this.session?.id || event?.epoch !== this.session?.epoch ||
        !Number.isSafeInteger(event?.seq) || event.seq < 0 || !statuses.includes(event?.status)) return;
    const clean = { session: event.session, epoch: event.epoch, seq: event.seq, status: event.status, ...(event.requestId ? { requestId: event.requestId } : {}) };
    if (job.dispatch && job.dispatch.requestId === clean.requestId && clean.status === 'accepted') {
      job.dispatch.authority = clean; job.dispatch.resolve(clean);
    }
    if (clean.status === 'accepted' && this.accept(job, clean)) return;
    if (job.admission && sameReceipt(job.admission.receipt, clean) && ['rejected', 'cancelled'].includes(clean.status)) {
      this.fail(job, clean.status === 'rejected' ? 'playground_admission_rejected' : 'playground_desynchronized'); return;
    }
    let consumed = false;
    try { if (job.transaction) consumed = this.journal.feedback(clean); }
    catch { this.fail(job, 'playground_feedback'); return; }
    const state = this.journal.status();
    if (state.pending?.stage === 'desynchronized') { this.fail(job, 'playground_desynchronized'); return; }
    if (job.transaction && state.revision > job.revision && !state.pending) { this.finish(job, 'committed'); return; }
    if (!consumed && !job.buffer.some(value => value.seq === clean.seq && value.status === clean.status)) {
      if (job.buffer.length >= 64) { this.fail(job, 'playground_feedback_overflow'); return; }
      job.buffer.push(clean);
    }
  }
  replay(job) {
    const buffered = job.buffer; job.buffer = [];
    for (const event of buffered) { if (!this.live(job)) return; this.receive(event, this.generation); }
  }
  accept(job, event) {
    if (job.known.some(receipt => sameReceipt(receipt, event))) return true;
    const waiting = job.admission;
    if (!waiting || !sameReceipt(waiting.receipt, event)) return false;
    job.admission = undefined; waiting.resolve(event); return true;
  }
  async admission(job, phase, receipt, owner) {
    if (receipt?.status === 'rejected') { this.fail(job, 'playground_admission_rejected'); return null; }
    if (receipt?.session !== owner.id || receipt?.epoch !== owner.epoch || !Number.isSafeInteger(receipt?.seq) || receipt.seq < 0 ||
        !['accepted', 'pending'].includes(receipt?.status)) { this.fail(job, 'playground_admission_uncertain'); return null; }
    if (receipt.status === 'accepted') return receipt;
    this.journal.admit(job.transaction, phase, receipt);
    const promise = new Promise(resolve => { job.admission = { receipt: { session: receipt.session, epoch: receipt.epoch, seq: receipt.seq }, resolve }; });
    job.waitCode = 'playground_admission_pending'; this.replay(job);
    const accepted = await promise;
    if (!this.live(job)) return null;
    job.waitCode = undefined; return accepted;
  }
  async sendCommand(job, command, session) {
    let resolve;
    const accepted = new Promise(done => { resolve = done; });
    const dispatch = { requestId: command.requestId, resolve };
    job.dispatch = dispatch;
    const transport = Promise.resolve().then(() => this.options.send(command, { ...session })).then(receipt => {
      if (dispatch.authority && this.live(job) &&
          (!sameReceipt(dispatch.authority, receipt) || !['accepted', 'pending'].includes(receipt?.status)))
        this.fail(job, 'playground_receipt_conflict');
      return receipt;
    }).catch(error => {
      if (dispatch.authority && ['rejected', 'cancelled'].includes(error?.receipt?.status) && this.live(job))
        this.fail(job, 'playground_receipt_conflict');
      throw error;
    });
    try { return await Promise.race([transport, accepted]); }
    finally { if (job.dispatch === dispatch) job.dispatch = undefined; }
  }
  async run(job, args) {
    try {
      job.stage = 'session';
      const session = sessionValue(await this.options.currentSession()); if (!this.live(job)) return;
      if (args.operation === 'recover') { await this.recover(job, session); return; }
      if (!this.bind(session)) return;
      job.stage = 'feedback_connection';
      await this.stream(job); if (!this.live(job)) return;
      let proposal;
      try { proposal = this.journal.propose({ sessionId: session.id, ...args }); }
      catch (error) { this.finish(job, 'rejected', /^playground_[a-z_]+$/.test(error.message) ? error.message : 'playground_arguments'); return; }
      job.transaction = proposal.transaction; job.revision = proposal.baseRevision;
      for (const { phase, ...command } of proposal.commands) {
        if (!this.live(job)) return;
        job.stage = phase + '_http_or_correlated_ack';
        const reply = await this.sendCommand(job, { ...command, requestId: `${proposal.transaction}:${phase}` }, session);
        if (!this.live(job)) return;
        job.stage = phase + '_admission';
        const receipt = await this.admission(job, phase, reply, session); if (!this.live(job) || !receipt) return;
        this.journal.admit(proposal.transaction, phase, receipt);
        job.known.push({ session: receipt.session, epoch: receipt.epoch, seq: receipt.seq }); this.replay(job);
      }
      job.stage = 'body_and_baseline_completion';
    } catch { if (this.live(job)) this.fail(job, 'playground_transport'); }
  }
  async recover(job, before) {
    this.requireRecovery(this.session ?? before);
    const owner = { ...this.recoveryOwner };
    const next = sessionValue(await this.options.invalidate({ ...owner })); if (!this.live(job)) return;
    if (next.id === owner.id && next.epoch === owner.epoch) { this.fail(job, 'playground_recovery_not_invalidated'); return; }
    this.detach(); this.journal?.dispose(); this.session = next; this.journal = new PlaygroundSession(next.id); this.required = false;
    this.recoveryOwner = undefined;
    this.finish(job, 'recovered');
  }
  async begin(value) {
    const args = argumentsFor(value);
    if (this.closed) throw Error('playground_closed');
    if (this.job) throw Error('playground_busy');
    if (args.expectedRevision !== (this.journal?.status().revision ?? 0)) throw Error('playground_revision');
    if (this.required && args.operation !== 'recover') throw Error('playground_recovery_required');
    const job = { startedAt: performance.now(), stage: 'session', done: false, buffer: [], known: [], deadline: performance.now() + this.timeoutMs }; job.result = new Promise(resolve => { job.resolve = resolve; }); this.job = job;
    job.timer = setTimeout(() => this.fail(job, job.waitCode ?? 'playground_timeout'), this.timeoutMs);
    await Promise.race([this.run(job, args), job.result]);
    return { result: job.result };
  }
  async read(includeScene = false) {
    if (includeScene !== false && includeScene !== true) throw Error('playground_arguments');
    if (!this.closed) {
      try { this.bind(sessionValue(await this.options.currentSession())); }
      catch { this.requireRecovery(); this.detach(); if (this.job) this.fail(this.job, 'playground_transport'); }
    }
    return this.state(includeScene);
  }
  interrupt() {
    if (this.closed) return;
    if (this.job) this.fail(this.job, 'playground_user_interrupt');
    if (this.required && this.recoveryOwner) return { ...this.recoveryOwner };
  }
  close() {
    this.closed = true;
    if (this.job) this.fail(this.job, 'playground_closed');
    this.detach(); this.journal?.dispose();
    this.recoveryOwner = undefined;
  }
}

export function createPlaygroundController(options) {
  const controller = new Controller(options);
  return { begin: value => controller.begin(value), read: includeScene => controller.read(includeScene),
    interrupt: reason => controller.interrupt(reason), close: () => controller.close() };
}
