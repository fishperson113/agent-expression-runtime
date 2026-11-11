export class ReactiveEvaluationTrace {
  #recent = []; #pending = new Map(); #sequence = 0;
  time() {
    const at = performance.now();
    return Number.isFinite(at) ? Math.max(0, at) : 0;
  }
  start(operation, waiters) {
    const entry = { id: ++this.#sequence, operation, atMs: this.time() };
    this.#pending.set(entry.id, entry);
    this.record({ ...entry, phase: 'started', elapsedMs: 0, waiters });
    return entry.id;
  }
  finish(id, phase, waiters) {
    const entry = this.#pending.get(id);
    if (!entry) return;
    this.#pending.delete(id);
    const atMs = this.time();
    this.record({ ...entry, atMs, phase, elapsedMs: Math.max(0, atMs - entry.atMs), waiters });
  }
  record(entry) {
    this.#recent.push(entry);
    if (this.#recent.length > 32) this.#recent.shift();
  }
  snapshot() {
    const at = this.time();
    return { recent: this.#recent.map(entry => ({ ...entry })), pending: [...this.#pending.values()].map(entry =>
      ({ id: entry.id, operation: entry.operation, ageMs: Math.max(0, at - entry.atMs) })) };
  }
}
