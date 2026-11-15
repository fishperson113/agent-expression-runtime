export class PresentationTransport {
  constructor(Rpc, { idleMs = 30000, maxJobs = 16 } = {}) {
    if (!Number.isSafeInteger(idleMs) || idleMs < 1 || !Number.isSafeInteger(maxJobs) || maxJobs < 1) throw Error('presentation_transport_limits');
    Object.assign(this, { Rpc, idleMs, maxJobs });
  }
  async acquire(command, args, cwd, notify, failed, env) {
    if (this.active || this.closed) throw Error('presentation_transport_unavailable');
    this.active = { notify, failed };
    try {
      await this.retiring;
      if (this.closed) throw Error('presentation_transport_closed');
      clearTimeout(this.timer);
      if (!this.rpc) {
        this.jobs = 0; this.initialized = false;
        const identity = this.identity = {};
        this.rpc = new this.Rpc(command, args, cwd,
          (...values) => { if (this.identity === identity) this.active?.notify(...values); },
          code => { if (this.identity !== identity) return; const listener = this.active?.failed; this.retire(); listener?.(code); }, env);
      }
      return this.rpc;
    } catch (error) { this.active = undefined; throw error; }
  }
  async release(healthy) {
    this.active = undefined;
    if (!healthy || this.closed || ++this.jobs >= this.maxJobs) await this.retire();
    else {
      this.timer = setTimeout(() => this.retire(), this.idleMs);
      this.timer.unref?.();
    }
  }
  retire() {
    clearTimeout(this.timer);
    const rpc = this.rpc;
    this.rpc = undefined; this.identity = undefined; this.initialized = false;
    if (rpc) {
      this.retiring = Promise.resolve(rpc.settled);
      try { rpc.close(); } catch {}
    }
    return this.retiring;
  }
  close() { this.closed = true; return this.retire(); }
}
