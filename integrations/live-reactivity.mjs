const allowed = new Set(['user_arrived', 'user_left', 'looked_away', 'looked_back', 'expression_changed']);

export class LiveReactivity {
  pending = new Map(); seen = -1; enabled = false; session; thread; active;
  starting = false; uncertain = false; interrupting = false; queued = []; userRequests = new Map(); userTurns = new Set(); reactionThread; completedTurn; revoked = false;
  lastStart = -Infinity; starts = []; changedAt = 0; closed = false; queuedAt = 0; generation = 0; selectionId; completed = new Set();
  constructor({ output, request, forward, reject = () => {}, log = () => {}, now = () => Date.now() }) {
    Object.assign(this, { output, request, forward, reject, log, now });
  }
  reset() { this.pending.clear(); this.seen = -1; }
  async sample(value) {
    if (this.closed || !value) return;
    if (this.queued.length && this.now() - this.queuedAt >= 10000) this.failQueued();
    if ((this.starting || this.active) && this.now() - this.lastStart >= 30000) this.yield();
    const now = this.now(), enabled = value?.enabled && !value.stopped;
    if (!enabled || value.sessionId !== this.session || this.output.thread !== this.thread || !this.enabled) {
      if (!enabled || value.sessionId !== this.session || this.output.thread !== this.thread) this.yield();
      if (this.output.thread !== this.thread) this.userTurns.clear();
      this.reset(); this.session = value?.sessionId; this.thread = this.output.thread;
      this.enabled = !!enabled;
      this.baseline(value);
      if (!enabled) this.yield();
      return;
    }
    if (!['tracking', 'absent'].includes(value.camera) || now - value.capturedAt > 1500) {
      this.pending.clear(); this.baseline(value); this.yield(); return;
    }
    for (const event of (value.events ?? []).slice(-20)) {
      if (!Number.isSafeInteger(event.seq) || event.seq <= this.seen) continue;
      this.seen = event.seq;
      if (!allowed.has(event.type) || now - event.at > 5000 || event.at > now) continue;
      this.pending.set(this.key(event.type), event); this.changedAt = now;
    }
    for (const [key, event] of this.pending) if (now - event.at > 5000) this.pending.delete(key);
    if (this.canStart(now)) this.start(now);
  }
  baseline(value) {
    const sequences = (value?.events ?? []).slice(-20).map(event => event.seq).filter(Number.isSafeInteger);
    this.seen = Math.max(this.seen, ...sequences);
  }
  key(type) {
    if (type === 'user_arrived' || type === 'user_left') return 'presence';
    if (type === 'looked_away' || type === 'looked_back') return 'orientation';
    return 'expression';
  }
  canStart(now) {
    this.starts = this.starts.filter(at => now - at < 60000);
    return this.enabled && this.thread && this.pending.size && now - this.changedAt >= 750 &&
      this.selectionId === undefined && !this.active && !this.starting && !this.uncertain && ![...this.userRequests.values()].includes(this.thread) && !this.queued.length &&
      !this.userTurns.size && !this.output.turn && this.output.state === 'idle' && now - this.lastStart >= 15000 && this.starts.length < 4;
  }
  start(now) {
    const events = [...this.pending.values()].map(event => ({ type: event.type, at: event.at }));
    this.pending.clear(); this.starting = true; this.reactionThread = this.thread; this.completedTurn = undefined; this.revoked = false; this.lastStart = now; this.starts.push(now);
    const generation = ++this.generation;
    this.log('Requesting Codex reaction to local typed events.');
    const text = 'Fisch local camera observation, not a user request. These are debounced geometric estimates, not emotions or intent. ' +
      'No image or audio was sent. Use only Fisch observe/express tools for a brief optional visual reaction, or do nothing. ' +
      'Do not run commands, edit files, contact anyone, or take other actions. User input takes priority. Events: ' + JSON.stringify(events);
    void this.request('turn/start', { threadId: this.thread, input: [], toolOutput: { name: 'fisch_local_observation', output: text } })
      .then(message => this.started(message, generation)).catch(() => {
        if (this.closed || generation !== this.generation || this.completedTurn) return;
        this.starting = false; this.uncertain = true; this.pending.clear();
        this.log('Reactive request outcome unknown; automatic reactions paused.'); this.failQueued();
      });
  }
  started(message, generation) {
    if (this.closed || generation !== this.generation) return;
    this.starting = false;
    if (message.error) {
      this.active = undefined; this.log('Codex rejected the reactive request.'); this.flush(); return;
    }
    const turn = message.result?.turn;
    if (!turn?.id) { this.uncertain = true; this.log('Reactive response missing turn ID; automatic reactions paused.'); return; }
    if (['completed', 'interrupted', 'failed'].includes(turn.status)) { this.active = undefined; this.flush(); return; }
    if (this.completedTurn === turn.id) { this.flush(); return; }
    this.active = this.active?.turnId === turn.id ? this.active : { threadId: this.reactionThread, turnId: turn.id };
    if (this.revoked || !this.enabled || this.queued.length) this.yield();
  }
  client(message) {
    const method = message.method, threadId = message.params?.threadId;
    if (['thread/start', 'thread/resume', 'thread/fork'].includes(method)) {
      this.selectionId = message.id; this.reset(); this.enabled = false; this.yield();
    }
    if (method !== 'turn/start') return true;
    this.pending.clear();
    if (message.id !== undefined) {
      if (this.userRequests.size >= 64) throw Error('reactive_user_request_limit');
      this.userRequests.set(message.id, threadId);
    }
    if (this.uncertain && threadId === this.reactionThread) { this.yield(); this.rejectUser(message); return false; }
    if ((this.starting || this.active) && threadId === this.reactionThread) {
      if (this.queued.length >= 8) throw Error('reactive_user_queue_full');
      if (!this.queued.length) this.queuedAt = this.now();
      this.queued.push(message); this.yield(); return false;
    }
    return true;
  }
  event(message) {
    if (this.closed) return;
    const { method, params = {} } = message;
    if (message.id !== undefined && message.id === this.selectionId && (message.result || message.error)) this.selectionId = undefined;
    if (this.userRequests.has(message.id) && (message.result || message.error)) {
      const threadId = this.userRequests.get(message.id); this.userRequests.delete(message.id);
      if (threadId === this.output.thread && message.result?.turn?.id && !this.completed.has(message.result.turn.id)) this.userTurns.add(message.result.turn.id);
    }
    if (method === 'turn/started' && params.threadId === this.reactionThread && (this.starting || this.uncertain) && !this.active) {
      this.active = { threadId: params.threadId, turnId: params.turn?.id };
      if (this.revoked || this.queued.length || !this.enabled) this.yield();
    }
    if (method === 'turn/completed' && params.threadId === this.active?.threadId && params.turn?.id === this.active?.turnId) {
      this.completedTurn = params.turn.id;
      this.active = undefined; this.starting = false; this.uncertain = false; this.interrupting = false;
      this.log('Reactive turn finished.'); this.flush();
    }
    if (method === 'turn/completed') {
      this.userTurns.delete(params.turn?.id); this.completed.add(params.turn?.id);
      if (this.completed.size > 64) this.completed.delete(this.completed.values().next().value);
    }
    const descriptions = { 'turn/started': 'Codex turn started.', 'turn/completed': 'Codex turn finished.' };
    const items = { mcpToolCall: 'Codex tool call', commandExecution: 'Codex command', fileChange: 'Codex file change' };
    if (params.threadId !== this.output.thread) return;
    if (descriptions[method]) this.log(descriptions[method]);
    if (items[params.item?.type] && ['item/started', 'item/completed'].includes(method))
      this.log(items[params.item.type] + (method === 'item/started' ? ' started.' : ' finished.'));
  }
  yield() {
    this.revoked = true; this.pending.clear();
    if (!this.active?.turnId || this.interrupting) return;
    this.interrupting = true;
    const owned = this.active;
    this.log('Yielding reactive turn to user control.');
    void this.request('turn/interrupt', owned).then(message => {
      if (message.error && this.active === owned) { this.uncertain = true; this.log('Reactive cancellation failed; awaiting completion.'); }
    }).catch(() => { if (this.active === owned) { this.uncertain = true; this.log('Reactive cancellation unconfirmed; awaiting completion.'); } });
  }
  rejectUser(message) {
    this.userRequests.delete(message.id);
    this.reject(message, { code: -32000, message: 'Fisch could not confirm the reactive turn stopped. Your input was not sent. Wait for completion or restart Live, then retry.' });
  }
  failQueued() {
    if (this.queued.length) this.log('User input was not sent: reactive cancellation unconfirmed. Retry after completion or restart Live.');
    for (const message of this.queued.splice(0)) this.rejectUser(message);
  }
  flush() {
    if (this.active || this.starting || this.uncertain) return;
    for (const message of this.queued.splice(0)) {
      try { this.forward(message); }
      catch { this.userRequests.delete(message.id); this.reject(message, { code: -32000, message: 'Fisch could not forward your input. Restart Live and retry.' }); }
    }
  }
  close() { this.closed = true; this.enabled = false; this.reset(); this.queued = []; this.userRequests.clear(); this.userTurns.clear(); }
}

