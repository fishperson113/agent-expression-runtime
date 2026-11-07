import { planBody } from './expression-plan.mjs';
import { validEvent, redactMessage } from './interaction-events.mjs';

export const cleanContext = redactMessage;
export class ExpressionPlanner {
  generation = 0; attempts = 0; applied = 0; discarded = 0; requestsThisTurn = 0;
  status = 'unknown'; mode = 'disabled'; error = null; closed = false; paused = false;
  lastRequest = -Infinity; seen = new Set();
  constructor({ engine, plan, now = () => performance.now(), wallNow = Date.now, timeoutMs = 45000,
    intervalMs = 10000, onApplied = () => {}, requireAssembly = false, reason }) {
    Object.assign(this, { engine, plan, now, wallNow, timeoutMs, intervalMs, onApplied, requireAssembly, reason });
    this.mode = plan ? 'ready' : 'disabled';
  }
  update(status) {
    this.status = status;
    if (['idle', 'done', 'unknown'].includes(status) && this.pending?.type !== 'user_message') this.pending = null;
  }
  accept(event) {
    if (this.closed || !validEvent(event, this.wallNow()) || this.seen.has(event.id)) return false;
    if (event.type === 'user_message' && this.current && event.at < this.current.at) return false;
    event = { id: event.id, sessionId: event.sessionId, turnId: event.turnId, type: event.type, at: event.at, text: redactMessage(event.text) };
    if (event.type !== 'user_message' && this.paused) return false;
    if (event.type !== 'user_message' && (!this.current || event.sessionId !== this.current.sessionId ||
        (event.turnId && event.turnId !== this.current.turnId))) return false;
    this.seen.add(event.id); if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
    if (event.type === 'user_message') {
      this.invalidate(); this.paused = false; this.current = { ...event, text: redactMessage(event.text) };
      this.obstacle = null; this.requestsThisTurn = 0; this.lastRequest = -Infinity; this.pending = this.current;
    } else if (event.type === 'interrupted') this.invalidate();
    else if (['task_failure', 'task_success', 'needs_user'].includes(event.type)) {
      if (event.type === 'needs_user') this.obstacle = event;
      if (this.status === 'working' && this.requestsThisTurn < 2 && this.pending?.type !== 'user_message') this.pending = event;
    }
    return true;
  }
  invalidate() {
    this.generation++; this.controller?.abort(); this.controller = null; this.pending = null; this.paused = true;
    if (this.plan && !this.closed) this.mode = 'ready';
  }
  tick() {
    if (!this.plan || this.closed || this.paused || !this.pending || this.controller || this.requestsThisTurn >= 2) return;
    const event = this.pending;
    if (this.wallNow() - event.at > 30000) { this.pending = null; return; }
    if (this.now() - this.lastRequest < this.intervalMs) return;
    this.pending = null; this.job = this.request(event, this.generation);
  }
  async request(event, generation) {
    const controller = this.controller = new AbortController();
    this.lastRequest = this.now(); this.requestsThisTurn++; this.attempts++; this.mode = 'planning'; this.error = null;
    const context = { event, activity: this.status, userMessage: this.current.text,
      previousReaction: this.lastReaction, previousConcept: this.lastConcept, previousPlan: this.lastPlan };
    let timer, stop;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { reject(Error('timeout')); controller.abort(); }, this.timeoutMs);
      });
      const cancellation = new Promise((_, reject) => {
        stop = () => reject(Error('cancelled')); controller.signal.addEventListener('abort', stop, { once: true });
      });
      const value = await Promise.race([this.plan(context, controller.signal), timeout, cancellation]);
      if (this.closed || generation !== this.generation || controller.signal.aborted) { this.discarded++; return; }
      if (this.obstacle && this.obstacle.id !== event.id && this.obstacle.at >= event.at) {
        this.discarded++; this.mode = 'ready'; return;
      }
      if (value.eventId !== event.id) throw Error('event_mismatch');
      const body = planBody(value, this.requireAssembly), result = this.engine.express({ body });
      if (result.status !== 'accepted') throw Error('invalid_plan');
      this.applied++; this.mode = 'ready'; this.lastPlan = body; this.lastConcept = value.concept;
      this.lastReaction = { eventId: event.id, mood: value.mood, intensity: value.intensity, target: value.target };
      this.lastAppliedAt = new Date().toISOString(); this.onApplied(body, this.lastReaction);
    } catch (error) {
      if (this.closed || generation !== this.generation) this.discarded++;
      else { this.mode = 'fallback'; this.error = error.message === 'timeout' ? 'timeout' : 'plan_failed'; }
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', stop);
      if (this.controller === controller) this.controller = null;
    }
  }
  get info() {
    return { mode: this.mode, reason: this.reason, attempts: this.attempts, applied: this.applied,
      discarded: this.discarded, queued: !!this.pending, error: this.error, lastPlan: this.lastPlan,
      lastConcept: this.lastConcept, lastReaction: this.lastReaction, lastAppliedAt: this.lastAppliedAt,
      eventId: this.current?.id, requestsThisTurn: this.requestsThisTurn, requestLimit: 2,
      idleInference: false, repertoireRotation: false, transport: this.plan?.transport?.() };
  }
  close() { this.closed = true; this.invalidate(); this.current = null; this.plan?.close?.(); }
}
