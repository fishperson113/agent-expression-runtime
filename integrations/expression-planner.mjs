import { createHash } from 'node:crypto';
import { planBody } from './expression-plan.mjs';

export function cleanContext(text) {
  return String(text ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]').slice(-6000);
}

export class ExpressionPlanner {
  generation = 0; attempts = 0; applied = 0; discarded = 0;
  status = 'unknown'; lastHash = ''; lastRead = -Infinity; lastRequest = -Infinity;
  mode = 'disabled'; error = null; closed = false;
  constructor({ engine, plan, readContext, now = () => performance.now(), timeoutMs = 4000, intervalMs = 10000, reason }) {
    Object.assign(this, { engine, plan, readContext, now, timeoutMs, intervalMs });
    this.mode = plan ? 'ready' : 'disabled'; this.reason = reason;
  }
  update(status) {
    if (this.closed || this.status === status) return;
    this.invalidate(); this.status = status; this.lastHash = ''; this.lastRead = -Infinity; this.pending = null;
    if (this.plan) this.mode = 'ready';
  }
  invalidate() {
    this.generation++; this.controller?.abort(); this.controller = null;
  }
  tick() {
    if (!this.plan || this.closed || this.reading || this.now() - this.lastRead < 2000) return;
    this.lastRead = this.now(); const generation = this.generation;
    this.reading = this.capture(generation).finally(() => { this.reading = null; });
  }
  async capture(generation) {
    try {
      const text = cleanContext(await this.readContext());
      if (!text.trim() || this.closed || generation !== this.generation) return;
      const hash = createHash('sha256').update(text).digest('hex');
      if (hash !== this.lastHash) {
        this.invalidate(); this.lastHash = hash; this.pending = { activity: this.status, visibleContext: text };
      }
      if (this.pending && !this.controller && this.now() - this.lastRequest >= this.intervalMs) {
        const context = this.pending; this.pending = null;
        this.job = this.request(context, this.generation);
      }
    } catch { if (!this.closed && generation === this.generation) { this.mode = 'fallback'; this.error = 'context_error'; } }
  }
  async request(context, generation) {
    const controller = this.controller = new AbortController();
    this.lastRequest = this.now(); this.attempts++; this.mode = 'planning'; this.error = null;
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error('timeout')); }, this.timeoutMs);
      });
      const value = await Promise.race([this.plan(context, controller.signal), timeout]);
      if (this.closed || generation !== this.generation || controller.signal.aborted) { this.discarded++; return; }
      const result = this.engine.express({ body: planBody(value) });
      if (result.status !== 'accepted') throw Error('invalid_plan');
      this.applied++; this.mode = 'ready';
    } catch (error) {
      if (this.closed || generation !== this.generation) this.discarded++;
      else { this.mode = 'fallback'; this.error = error.message === 'timeout' ? 'timeout' : 'plan_failed'; }
    } finally { clearTimeout(timer); if (this.controller === controller) this.controller = null; }
  }
  get info() {
    return { mode: this.mode, reason: this.reason, attempts: this.attempts, applied: this.applied,
      discarded: this.discarded, error: this.error };
  }
  close() { this.closed = true; this.invalidate(); }
}
