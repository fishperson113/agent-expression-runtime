export class LiveOutput {
  thread; turn; state = 'idle'; lastDelta = -Infinity; strength = 0;
  accept(message, at = performance.now()) {
    const { method, params = {} } = message;
    if (method === 'turn/started') {
      if (this.thread && params.threadId !== this.thread) return;
      this.thread = params.threadId; this.turn = params.turn?.id;
      this.state = 'working'; this.strength = 0; this.lastDelta = -Infinity;
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
