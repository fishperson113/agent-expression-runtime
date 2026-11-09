export class LiveChat {
  messages = []; generation = 0; revision = 0; thread; pending = false; closed = false; stopping;
  active; error = ''; uncertain = false;
  constructor({ output, transport, reactor }) { Object.assign(this, { output, transport, reactor }); }
  selection() {
    this.generation++; this.active = undefined; this.uncertain = false; this.stopping = undefined;
    this.error = ''; this.revision++;
  }
  sync() {
    if (this.thread === this.output.thread) return;
    this.thread = this.output.thread; this.messages = []; this.selection();
  }
  valid(generation, thread) {
    return !this.closed && !this.uncertain && generation === this.generation && thread === this.output.thread &&
      this.output.selection === undefined;
  }
  canSend() {
    const reactive = this.reactor.starting || this.reactor.active;
    return !!this.thread && this.valid(this.generation, this.thread) && !this.pending &&
      !this.reactor.userRequests.size && !this.reactor.userTurns.size && !this.reactor.uncertain && (!this.output.turn || !!reactive);
  }
  async send(value) {
    this.sync();
    if (!this.canSend() || value.generation !== this.generation) throw Error('chat_not_ready');
    if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 16000) throw Error('chat_invalid_text');
    const generation = this.generation, threadId = this.thread;
    this.pending = true; this.error = ''; this.revision++;
    try {
      const message = await this.transport.submitUser({ threadId, input: [{ type: 'text', text: value.text, text_elements: [] }] },
        () => this.valid(generation, threadId), id => this.reactor.userRequests.delete(id));
      if (message.error) throw Error('Codex rejected this message.');
      return { status: 'accepted' };
    } catch (error) {
      if (generation === this.generation) {
        this.uncertain = !!error.uncertain;
        this.error = this.uncertain ? 'Message outcome unknown. Do not resend; check the terminal or restart Live.' :
          'Message was not accepted. Check the terminal and retry when ready.';
      }
      throw Error(this.error || 'Chat session changed.');
    } finally { this.pending = false; this.revision++; }
  }
  async cancel(value) {
    if (value.generation !== this.generation || this.closed || this.output.selection !== undefined || !this.active) throw Error('chat_no_turn');
    const owned = this.active;
    if (this.stopping === owned.id) return { status: 'stopping' };
    this.stopping = owned.id; this.revision++;
    try {
      const result = await this.transport.request('turn/interrupt', { threadId: this.thread, turnId: owned.id });
      if (result.error) throw Error('interrupt_rejected');
      return { status: 'stopping' };
    } catch {
      if (this.active === owned) { this.error = 'Stopping is unconfirmed. Check the terminal.'; this.revision++; }
      throw Error('Stopping is unconfirmed.');
    }
  }
  accept(message) {
    this.sync();
    const { method, params = {} } = message;
    if (params.threadId !== this.thread || this.output.selection !== undefined) return;
    if (method === 'turn/started') { this.active = { id: params.turn?.id }; this.revision++; }
    if (!this.active) return;
    if (method === 'turn/completed' && params.turn?.id === this.active.id) {
      for (const item of this.messages) if (item.turn === this.active.id) item.status = params.turn.status;
      this.active = undefined; this.stopping = undefined;
      if (this.uncertain) { this.uncertain = false; this.error = ''; }
      this.revision++; return;
    }
    if (params.turnId !== this.active.id) return;
    if (method === 'item/agentMessage/delta' && typeof params.delta === 'string')
      this.update(params.itemId, 'assistant', params.delta, true);
    if (['item/started', 'item/completed'].includes(method)) this.item(params.item);
  }
  item(item) {
    if (item?.type === 'agentMessage' && typeof item.text === 'string') this.update(item.id, 'assistant', item.text);
    if (item?.type === 'userMessage' && Array.isArray(item.content)) {
      const text = item.content.filter(part => part.type === 'text' && typeof part.text === 'string')
        .slice(0, 32).map(part => part.text.slice(0, 16000)).join('\n');
      this.update(item.id, 'user', text);
    }
  }
  update(id, role, text, delta = false) {
    if (typeof id !== 'string' || !text) return;
    let entry = this.messages.find(item => item.id === id && item.turn === this.active.id);
    if (!entry) { entry = { id, turn: this.active.id, role, text: '', status: 'streaming', truncated: false }; this.messages.push(entry); }
    const length = (delta ? entry.text.length : 0) + text.length;
    entry.text = (delta ? entry.text + text.slice(0, 64000) : text).slice(0, 64000);
    entry.truncated = length > 64000 || (delta && entry.truncated);
    while (this.messages.length > 80 || this.messages.reduce((sum, item) => sum + item.text.length, 0) > 128000) this.messages.shift();
    this.revision++;
  }
  snapshot() {
    this.sync();
    return { generation: this.generation, revision: this.revision, available: !this.closed && !!this.thread,
      canSend: this.canSend(), canCancel: !this.closed && this.output.selection === undefined && !!this.active && !this.stopping, pending: this.pending,
      stopping: !!this.stopping, waiting: this.output.state === 'waiting', error: this.error, messages: this.messages };
  }
  close() { this.closed = true; this.generation++; this.revision++; }
}

export async function bindLiveChat(page, chat) {
  const expected = new URL(page.url());
  await page.exposeBinding('fischLiveChat', (source, value) => {
    const current = new URL(source.frame.url());
    if (source.page !== page || source.frame !== page.mainFrame() || current.origin !== expected.origin ||
      current.pathname !== expected.pathname || current.search !== expected.search || page.isClosed() ||
      !value || !['send', 'cancel'].includes(value.action)) throw Error('chat_source_rejected');
    return value.action === 'send' ? chat.send(value) : chat.cancel(value);
  });
}
