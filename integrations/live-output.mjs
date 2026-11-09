export class LiveOutput {
  thread; turn; selection; state = 'idle'; lastDelta = -Infinity; strength = 0;
  revision = 0; turnRequests = new Map(); completed = new Set();
  constructor(onSelect = () => {}) { this.onSelect = onSelect; }
  request(message) {
    if (message.id !== undefined && ['thread/start', 'thread/resume', 'thread/fork'].includes(message.method)) {
      this.selection = message.id; this.revision++; this.turnRequests.clear();
    }
    if (message.id !== undefined && message.method === 'turn/start' && typeof message.params?.threadId === 'string') {
      if (this.turnRequests.size >= 64) return;
      this.turnRequests.set(message.id, { threadId: message.params.threadId, revision: this.revision });
    }
  }
  acknowledge(message) {
    const pending = this.turnRequests.get(message.id);
    if (!pending || (!message.result && !message.error)) return;
    this.turnRequests.delete(message.id);
    const turn = message.result?.turn;
    if (message.error || pending.revision !== this.revision || pending.threadId !== this.thread ||
      typeof turn?.id !== 'string' || !turn.id || turn.status !== 'inProgress' || this.completed.has(turn.id) || (this.turn && this.turn !== turn.id)) return;
    this.started(pending.threadId, turn.id);
  }
  started(threadId, turnId) {
    if (this.thread === threadId && this.turn === turnId) return;
    this.thread = threadId; this.turn = turnId;
    this.state = 'working'; this.strength = 0; this.lastDelta = -Infinity;
  }
  rememberCompleted(params) {
    if (params.threadId !== this.thread || typeof params.turn?.id !== 'string' || !params.turn.id) return;
    if (this.completed.has(params.turn.id)) return;
    if (this.completed.size >= 64) { this.turnRequests.clear(); this.completed.delete(this.completed.values().next().value); }
    this.completed.add(params.turn.id);
  }
  accept(message, at = performance.now()) {
    if (this.selection !== undefined && message.id === this.selection && ('result' in message || 'error' in message)) {
      this.selection = undefined;
      if (typeof message.result?.thread?.id === 'string') {
        const previous = this.thread;
        this.thread = message.result.thread.id; this.turn = undefined;
        this.state = 'idle'; this.strength = 0; this.lastDelta = -Infinity;
        if (this.thread !== previous) {
          this.completed.clear();
          return this.onSelect(this.thread, previous);
        }
      }
    }
    this.acknowledge(message);
    const { method, params = {} } = message;
    if (method === 'turn/completed') this.rememberCompleted(params);
    if (method === 'turn/started') {
      if ((this.thread && params.threadId !== this.thread) || typeof params.turn?.id !== 'string' || !params.turn.id || this.completed.has(params.turn.id)) return;
      this.started(params.threadId, params.turn.id);
    }
    if (params.threadId !== this.thread || !this.turn) return;
    if (method === 'item/agentMessage/delta' && params.turnId === this.turn && typeof params.delta === 'string' && params.delta.length) {
      this.lastDelta = at; this.strength = Math.min(1, 0.25 + params.delta.length / 30);
    }
    if (message.id !== undefined && method?.endsWith('/requestApproval')) this.state = 'waiting';
    if (method === 'serverRequest/resolved') this.state = 'working';
    if (method === 'turn/completed' && params.turn?.id === this.turn) {
      this.state = params.turn.status === 'interrupted' ? 'interrupted' : 'idle';
      this.turn = undefined; this.strength = 0;
    }
  }
  sample(at = performance.now()) {
    const age = at - this.lastDelta;
    return { turn: this.state, output: age >= 600 ? 0 : this.strength * Math.exp(-Math.max(0, age) / 180), quality: 'codex-agent-message-delta' };
  }
}
