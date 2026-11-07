import { createHash } from 'node:crypto';
import { planBody } from './expression-plan.mjs';
import { Repertoire, geometryKey } from './planner-repertoire.mjs';

export function cleanContext(text) {
  return String(text ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/(?:•\s*)?Working \([^\n)]*\)[^\n]*/g, '')
    .replace(/\b\d+(?:h|m)\s+\d+(?:m|s)\b/g, '[elapsed]')
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]').slice(-6000);
}

export function contextChange(previous, current) {
  const tokens = text => new Set(String(text).toLowerCase().replace(/\d+/g, '#').match(/[\p{L}_]{3,}/gu) ?? []);
  const before = tokens(previous), after = tokens(current), union = new Set([...before, ...after]);
  if (!union.size) return 0;
  let changed = 0;
  for (const token of union) if (before.has(token) !== after.has(token)) changed++;
  return changed / union.size;
}

export class ExpressionPlanner {
  generation = 0; attempts = 0; applied = 0; discarded = 0;
  status = 'unknown'; lastHash = ''; lastRead = -Infinity; lastRequest = -Infinity;
  mode = 'disabled'; error = null; closed = false;
  idleCycles = 0; idleReplays = 0; nextIdleAt = Infinity;
  repertoirePlays = 0; paused = false;
  idleRequests = 0; lastPlannedContext = null;
  constructor({ engine, plan, readContext, now = () => performance.now(), timeoutMs = 4000, intervalMs = 10000, debounceMs = 0, idleRefreshMs = 300000, idleRequestLimit = 2, idleReplayMs = 12000, onContextChange = () => {}, onApplied = () => {}, requireAssembly = false, cachePath, reason }) {
    Object.assign(this, { engine, plan, readContext, now, timeoutMs, intervalMs, debounceMs, idleRefreshMs, idleRequestLimit, idleReplayMs, onContextChange, onApplied });
    this.pool = new Repertoire(cachePath); this.requireAssembly = requireAssembly;
    this.mode = plan ? 'ready' : 'disabled'; this.reason = reason;
  }
  update(status) {
    if (this.closed || this.status === status) return;
    const completion = this.status === 'working' && ['idle', 'done'].includes(status);
    const restChange = ['idle', 'done'].includes(this.status) && ['idle', 'done'].includes(status);
    if (!completion && !restChange) { this.invalidate(); this.lastHash = ''; this.pending = null; this.lastRequest = -Infinity; }
    if (status === 'working') { this.idleRequests = 0; this.lastPlannedContext = null; }
    if (['idle', 'done'].includes(status) && !restChange) this.pending = null;
    this.status = status; this.lastRead = -Infinity; this.paused = false; this.resumeAt = 0;
    if (!restChange) this.nextIdleAt = this.now() + this.idleRefreshMs;
    if (this.plan) this.mode = this.controller ? 'planning' : 'ready';
  }
  invalidate() {
    this.generation++; this.controller?.abort(); this.controller = null; this.pending = null;
    this.nextIdleAt = Infinity;
    this.paused = true;
    this.resumeAt = this.now() + 10000;
    if (this.plan && !this.closed) this.mode = 'ready';
  }
  tick() {
    if (!this.plan || this.closed) return;
    this.replayIdle();
    if (this.reading || this.now() - this.lastRead < 2000) return;
    this.lastRead = this.now(); const generation = this.generation;
    this.reading = this.capture(generation).finally(() => { this.reading = null; });
  }
  async capture(generation) {
    try {
      const text = cleanContext(await this.readContext());
      if ((!text.trim() && !this.isIdle) || this.closed || generation !== this.generation) return;
      this.contextText = text;
      const hash = createHash('sha256').update(text).digest('hex');
      if (hash !== this.lastHash) {
        this.onContextChange(this.status); this.lastHash = hash; this.changedAt = this.now(); this.paused = false;
        if (!this.isIdle) this.pending = { activity: this.status, visibleContext: text, trigger: 'context_change', recentConcepts: this.pool.recent };
      }
      this.refreshIdle();
      if (this.pending && !this.controller && this.now() >= (this.resumeAt ?? 0) &&
          this.now() - this.lastRequest >= this.intervalMs && this.now() - this.changedAt >= this.debounceMs) {
        const context = this.pending; this.pending = null;
        if (!this.isIdle && this.lastPlannedContext !== null && contextChange(this.lastPlannedContext, text) < 0.35) return;
        this.job = this.request(context, this.generation);
      }
    } catch { if (!this.closed && generation === this.generation) { this.mode = 'fallback'; this.error = 'context_error'; } }
  }
  async request(context, generation) {
    const controller = this.controller = new AbortController();
    if (this.isIdle) this.idleRequests++;
    this.lastPlannedContext = context.visibleContext;
    this.lastRequest = this.now(); this.attempts++; this.mode = 'planning'; this.error = null;
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error('timeout')); }, this.timeoutMs);
      });
      const value = await Promise.race([this.plan(context, controller.signal), timeout]);
      if (this.closed || generation !== this.generation || controller.signal.aborted) { this.discarded++; return; }
      const body = planBody(value, this.requireAssembly), result = this.engine.express({ body });
      if (result.status !== 'accepted') throw Error('invalid_plan');
      this.applied++; this.mode = 'ready'; this.lastPlan = body;
      this.lastPlanGeneration = generation; this.lastReplay = this.now();
      this.lastAppliedAt = new Date().toISOString(); this.lastConcept = value.concept;
      this.pool.remember(body, value.concept); this.onApplied(body, 'planner');
    } catch (error) {
      if (this.closed || generation !== this.generation) this.discarded++;
      else { this.mode = 'fallback'; this.error = error.message === 'timeout' ? 'timeout' : 'plan_failed'; }
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = null;
      if (!this.closed && generation === this.generation) this.nextIdleAt = this.now() + this.idleRefreshMs;
    }
  }
  get isIdle() { return ['idle', 'done'].includes(this.status); }
  refreshIdle() {
    if (!this.isIdle || this.paused || this.idleRequests >= this.idleRequestLimit || this.pending || this.controller || this.now() < this.nextIdleAt) return;
    this.pending = { activity: this.status, visibleContext: this.contextText ?? '', trigger: 'idle_refresh',
      idleCycle: ++this.idleCycles, previousPlan: this.lastPlan, recentConcepts: this.pool.recent };
    this.nextIdleAt = Infinity;
  }
  replayIdle() {
    const interval = this.isIdle ? this.idleReplayMs : 18000;
    if (this.paused || this.now() < (this.resumeAt ?? 0) || !['idle', 'done', 'working'].includes(this.status) ||
        this.now() - (this.lastReplay ?? -Infinity) < interval) return;
    if (this.pool.entries.length) { this.reuse(); return; }
    if (!this.isIdle || !this.lastPlan || this.lastPlanGeneration !== this.generation) return;
    this.lastReplay = this.now();
    try {
      if (this.engine.express({ body: this.lastPlan }).status !== 'accepted') return;
      this.idleReplays++; this.lastReplayAt = new Date().toISOString(); this.onApplied(this.lastPlan);
    } catch { this.error = 'idle_replay_failed'; }
  }
  reuse() {
    const item = this.pool.pick(geometryKey(this.lastPlan)); if (!item) return false;
    this.lastReplay = this.now();
    try {
      if (this.engine.express({ body: item.body }).status !== 'accepted') return false;
      this.lastPlan = item.body; this.lastConcept = item.concept; this.lastPlanGeneration = this.generation;
      this.repertoirePlays++; if (this.isIdle) this.idleReplays++;
      this.lastReplayAt = new Date().toISOString(); this.onApplied(item.body, 'repertoire'); return true;
    } catch { this.pool.entries = this.pool.entries.filter(entry => entry.key !== item.key); return false; }
  }
  get info() {
    return { mode: this.mode, reason: this.reason, attempts: this.attempts, applied: this.applied,
      discarded: this.discarded, queued: !!this.pending, error: this.error,
      lastPlan: this.lastPlan, lastAppliedAt: this.lastAppliedAt,
      idleCycles: this.idleCycles, idleReplays: this.idleReplays, lastReplayAt: this.lastReplayAt,
      idleBudget: { used: this.idleRequests, limit: this.idleRequestLimit, intervalMs: this.idleRefreshMs },
      repertoire: this.pool.info, repertoirePlays: this.repertoirePlays, lastConcept: this.lastConcept,
      transport: this.plan?.transport?.() };
  }
  close() { this.closed = true; this.invalidate(); this.plan?.close?.(); }
}
