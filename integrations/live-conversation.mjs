import { randomUUID } from 'node:crypto';

const id = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const failure = code => Error(code);
const bytes = value => Buffer.byteLength(value, 'utf8');
const contextUnavailable = 'Fisch observation context: unavailable (capture failed, missing, invalid, or timed out).';
function sourceScope(value) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== 3 || !['documentToken', 'sessionId', 'revision'].every(key => fields[key] && 'value' in fields[key])) return null;
  const { documentToken, sessionId, revision } = Object.fromEntries(Object.entries(fields).map(([key, descriptor]) => [key, descriptor.value]));
  if (typeof documentToken !== 'string' || !documentToken.length || documentToken.length > 128 ||
    typeof sessionId !== 'string' || !sessionId.length || sessionId.length > 128 || !Number.isSafeInteger(revision) || revision < 0) return null;
  return { documentToken, sessionId, revision };
}
const clip = (value, limit) => new TextDecoder().decode(Buffer.from(value.slice(0, limit)).subarray(0, limit), { stream: true });

export class LiveConversation {
  #observer; #observerRevision = 0; #replyCandidate; #now;
  #output; #transport; #broker; #captureObservation; #thread; #selection; #generation = 0; #revision = 0;
  #ownedContexts = new Map(); #terminal = new Set(); #intent = 0; #messages = []; #unknown = new Set(); #pending; #stopping; #stopErrorTurn; #expressionFailureTurn; #error = ''; #closed = false; #navigated = false;
  constructor({ output, transport, broker, captureObservation, now = () => performance.now() }) {
    if (!output || typeof broker?.busy !== 'function' || typeof transport?.submitUser !== 'function' || typeof transport?.interruptUser !== 'function')
      throw failure('conversation_configuration');
    if (captureObservation !== undefined && typeof captureObservation !== 'function') throw failure('conversation_configuration');
    if (typeof now !== 'function') throw failure('conversation_configuration');
    this.#now = now; this.#captureObservation = captureObservation;
    this.#output = output; this.#transport = transport; this.#broker = broker;
    this.#thread = output.thread; this.#selection = output.selection;
  }
  #clearObserver() { this.#observer = undefined; this.#replyCandidate = undefined; this.#observerRevision++; }
  observerContext() {
    this.#sync();
    if (!this.#observer) return null;
    const ageMs = this.#now() - this.#observer.at;
    if (!this.#available() || !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= 60000) { this.#clearObserver(); return null; }
    const { at, ...context } = this.#observer;
    return freeze({ ...context, ageMs });
  }
  #confirmObserver(job, turn, text) {
    this.#sync();
    if (!this.#available() || job.observerRevision !== this.#observerRevision || job.generation !== this.#generation ||
      job.intent !== this.#intent || job.thread !== this.#thread || this.#pending !== job || this.#output.selection !== undefined ||
      !['inProgress', 'completed'].includes(turn.status)) return;
    const normalized = Array.from(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')).slice(0, 240).join('');
    if (!normalized.trim()) return;
    this.#observerRevision++;
    this.#observer = freeze({ revision: this.#observerRevision, submissionId: job.submissionId, threadId: job.thread,
      turnId: turn.id, text: normalized, at: this.#now() });
    this.#attachCompletedReply();
  }
  #attachCompletedReply() {
    const reply = this.#replyCandidate, context = this.#observer, age = context ? this.#now() - context.at : NaN;
    if (!reply?.completed || !context || reply.turnId !== context.turnId || !Number.isFinite(age) || age < 0 || age >= 60000) return;
    if (context.assistantReply?.messageId === reply.messageId) return;
    this.#observer = freeze({ ...context, revision: ++this.#observerRevision,
      assistantReply: { messageId: reply.messageId, text: reply.text, truncated: reply.truncated } });
  }
  #clear() {
    this.#clearObserver();
    this.#ownedContexts.clear(); this.#expressionFailureTurn = undefined; this.#terminal.clear(); this.#messages = []; this.#stopping = this.#stopErrorTurn = undefined; this.#error = '';
    this.#generation++; this.#revision++;
  }
  #sync() {
    if (this.#output.selection !== this.#selection) {
      this.#selection = this.#output.selection;
      if (this.#selection !== undefined) { this.#clearObserver(); this.#intent++; this.#revision++; }
    }
    if (this.#thread !== this.#output.thread) { this.#thread = this.#output.thread; this.#clear(); }
    const owner = this.#owner();
    if (owner && this.#expressionFailureTurn && owner !== this.#expressionFailureTurn) {
      if (this.#error === 'conversation_expression_failed') this.#error = '';
      this.#expressionFailureTurn = undefined; this.#revision++;
    }
    if (owner && this.#stopping && owner !== this.#stopping.turn) { this.#stopping = undefined; this.#revision++; }
    if (this.#stopErrorTurn && (this.#output.completed?.has(this.#stopErrorTurn) || owner && owner !== this.#stopErrorTurn)) {
      if (this.#error === 'conversation_stop_unconfirmed') this.#error = '';
      this.#stopErrorTurn = undefined; this.#revision++;
    }
  }
  inputAttempt(message) {
    if (['turn/start', 'turn/steer', 'turn/interrupt'].includes(message?.method) &&
      (this.#pending?.rpcId === undefined || message.id !== this.#pending.rpcId)) this.#clearObserver();
  }
  selectionAttempt() { this.#clearObserver(); this.#intent++; this.#revision++; }
  navigation() { this.#navigated = true; this.#clear(); this.#error = 'conversation_restart_required'; }
  transportLost() {
    const messages = this.#messages.map(value => ({ ...value, status: value.status === 'streaming' ? 'unknown' : value.status }));
    this.close(); this.#messages = messages; this.#error = 'conversation_transport_lost'; this.#revision++;
  }
  startupFailed() { this.close(); this.#error = 'conversation_startup_failed'; }
  close() { this.#closed = true; this.#unknown.clear(); this.#clear(); }
  #available() {
    return !this.#closed && !this.#navigated && id(this.#thread) && !this.#broker.closed && !this.#broker.browserUnavailable;
  }
  #owner() {
    return this.#available() && this.#output.selection === undefined && id(this.#output.turn) &&
      !this.#output.completed?.has(this.#output.turn) ? this.#output.turn : undefined;
  }
  #guard(job, message, cancelling = false) {
    this.#sync();
    if (!this.#available() || job.generation !== this.#generation || job.intent !== this.#intent || job.thread !== this.#thread ||
      this.#output.selection !== undefined || (!cancelling && this.#unknown.has(job.thread))) return false;
    if (!id(message?.id) || (job.rpcId !== undefined && job.rpcId !== message.id)) return false;
    job.rpcId = message.id;
    if (!cancelling && job.contextCapturedAt !== undefined && (job.contextRevoked || performance.now() - job.contextCapturedAt > job.contextValidForMs) && message.params?.input?.[1]) {
      job.contextText = contextUnavailable; message.params.input[1] = { type: 'text', text: contextUnavailable, text_elements: [] };
    }
    if (cancelling) return this.#owner() === job.turn;
    if (this.#pending !== job) return false;
    return !this.#output.turn && !this.#broker.turns?.size &&
      ![...(this.#broker.pending?.keys() ?? [])].some(key => key !== message?.id) &&
      !(this.#broker.queue ?? []).some(value => value.id !== message?.id);
  }
  #canSend() {
    return this.#available() && this.#output.selection === undefined && !this.#pending &&
      !this.#unknown.has(this.#thread) && this.#unknown.size < 64 && !this.#output.turn && !this.#broker.busy();
  }
  async #captureContext(job, userText) {
    let timer;
    const captured = Promise.resolve().then(() => this.#captureObservation(freeze({ submissionId: job.submissionId,
      thread: job.thread, generation: job.generation, intent: job.intent }))).catch(() => null);
    let context;
    try { context = await Promise.race([captured, new Promise(resolve => { timer = setTimeout(() => resolve(null), 250); })]); }
    finally { clearTimeout(timer); }
    this.#sync();
    if (!this.#available() || job.generation !== this.#generation || job.intent !== this.#intent || job.thread !== this.#thread ||
      this.#pending !== job || this.#output.selection !== undefined)
      throw Object.assign(failure('conversation_changed'), { uncertain: false });
    job.contextCapturedAt = performance.now();
    let text = context, validForMs = 1000;
    try { if (context && typeof context === 'object' && Object.getPrototypeOf(context) === Object.prototype) {
      const fields = Object.getOwnPropertyDescriptors(context);
      const scope = fields.sourceFence;
      const parsedScope = scope && 'value' in scope ? sourceScope(scope.value) : null;
      const validScope = !scope || parsedScope;
      if (Reflect.ownKeys(fields).length === (scope ? 3 : 2) && validScope && fields.text && fields.validForMs &&
        'value' in fields.text && 'value' in fields.validForMs && Number.isFinite(fields.validForMs.value) &&
        fields.validForMs.value >= 0 && fields.validForMs.value <= 1000) {
        text = fields.text.value; validForMs = fields.validForMs.value;
        if (scope) job.sourceFence = freeze(parsedScope);
      }
    }
    } catch { text = null; validForMs = 0; }
    job.contextValidForMs = validForMs;
    job.userText = userText; job.contextText = validForMs > 0 && typeof text === 'string' && text.length > 0 && bytes(text) <= 8192 ? text : contextUnavailable;
    return { type: 'text', text: job.contextText, text_elements: [] };
  }
  async send(value) {
    this.#clearObserver(); this.#sync();
    if (!this.#canSend() || value?.generation !== this.#generation) throw failure('conversation_unavailable');
    if (typeof value.text !== 'string' || !value.text.trim() || bytes(value.text) > 16000) throw failure('conversation_invalid_text');
    const job = { generation: this.#generation, intent: this.#intent, thread: this.#thread, submissionId: randomUUID(), observerRevision: this.#observerRevision, observerText: value.text };
    this.#pending = job; this.#error = ''; this.#revision++;
    try {
      const input = [{ type: 'text', text: value.text, text_elements: [] }];
      if (this.#captureObservation) input.push(await this.#captureContext(job, value.text));
      const reply = await this.#transport.submitUser({ threadId: job.thread,
        input }, message => this.#guard(job, message), key => { if (key === job.rpcId) this.#discard(key); });
      if (reply?.error) throw Object.assign(failure('conversation_rejected'), { uncertain: false });
      if (!id(reply?.result?.turn?.id) || !['inProgress', 'completed', 'interrupted', 'failed'].includes(reply.result.turn.status))
        throw Object.assign(failure('conversation_unknown'), { uncertain: true });
      if (job.contextText !== undefined) this.#rememberContext(reply.result.turn.id, job);
      this.#confirmObserver(job, reply.result.turn, job.observerText);
      return Object.freeze({ status: 'accepted' });
    } catch (error) {
      this.#clearObserver();
      const unknown = error?.uncertain !== false;
      if (unknown && !this.#closed) this.#unknown.add(job.thread);
      const code = unknown ? 'conversation_unknown' : (job.generation !== this.#generation || job.intent !== this.#intent) ? 'conversation_changed' : 'conversation_rejected';
      if (job.thread === this.#output.thread && this.#error !== 'conversation_transport_lost') this.#error = code;
      throw failure(code);
    } finally { if (this.#pending === job) this.#pending = undefined; this.#revision++; }
  }
  fenceObservation(rpcId, currentScope) {
    const job = this.#pending;
    if (!job || job.rpcId !== rpcId || !job.sourceFence) return;
    let compatible = false;
    try {
      const current = sourceScope(currentScope);
      compatible = !!current && ['documentToken', 'sessionId', 'revision'].every(key => current[key] === job.sourceFence[key]);
    } catch { /* Unreadable scope cannot authorize old observation data. */ }
    if (!compatible) job.contextRevoked = true;
  }
  #discard(key) {
    this.#broker.pending?.delete(key); this.#output.turnRequests?.delete(key);
  }
  async cancel(value) {
    this.#clearObserver(); this.#sync(); const turn = this.#owner();
    if (!turn || value?.generation !== this.#generation) throw failure('conversation_no_turn');
    if (this.#stopping?.turn === turn) return Object.freeze({ status: 'stopping' });
    if (this.#stopErrorTurn === turn && this.#error === 'conversation_stop_unconfirmed') {
      this.#error = ''; this.#stopErrorTurn = undefined;
    }
    const job = { generation: this.#generation, intent: this.#intent, thread: this.#thread, turn };
    this.#stopping = job; this.#revision++;
    try {
      const reply = await this.#transport.interruptUser({ threadId: job.thread, turnId: turn },
        message => this.#guard(job, message, true), key => { if (key === job.rpcId) this.#discard(key); });
      if (reply?.error) throw Object.assign(failure('conversation_stop_unconfirmed'), {
        uncertain: ![-32600, -32601, -32602].includes(reply.error.code),
      });
      return Object.freeze({ status: 'stopping' });
    } catch (error) {
      this.#sync();
      if (this.#stopping === job && job.generation === this.#generation &&
          job.thread === this.#thread && this.#owner() === job.turn) {
        if (error?.uncertain === false) this.#stopping = undefined;
        if (job.intent === this.#intent) { this.#error = 'conversation_stop_unconfirmed'; this.#stopErrorTurn = job.turn; }
        this.#revision++;
      }
      throw failure('conversation_stop_unconfirmed');
    }
  }
  #rememberContext(turn, job) {
    if (!id(turn) || job.thread !== this.#thread || job.generation !== this.#generation || job.intent !== this.#intent) return;
    this.#ownedContexts.set(turn, job);
    if (this.#ownedContexts.size > 64) this.#ownedContexts.delete(this.#ownedContexts.keys().next().value);
  }
  accept(message) {
    this.#sync();
    if (!this.#available() || this.#output.selection !== undefined) return;
    const { method, params = {} } = message;
    if (message.id === this.#pending?.rpcId && this.#pending && !message.error && id(message.result?.turn?.id)) {
      this.#pending.observerTurnId = message.result.turn.id;
      if (this.#pending.contextText !== undefined) this.#rememberContext(message.result.turn.id, this.#pending);
    }
    if (params.threadId !== this.#thread) return;
    if (method === 'turn/started' && this.#pending?.rpcId && id(params.turn?.id) && this.#output.turn === params.turn.id)
      this.#pending.observerTurnId = params.turn.id;
    if (method === 'turn/started' && !this.#pending?.rpcId && this.#observer?.turnId !== params.turn?.id) this.#clearObserver();
    if (method === 'turn/started' && this.#pending?.rpcId && this.#pending.contextText !== undefined)
      this.#rememberContext(params.turn?.id, this.#pending);
    if (method === 'turn/completed' && id(params.turn?.id) && this.#output.completed?.has(params.turn.id)) {
      if (this.#terminal.has(params.turn.id)) return;
      this.#terminal.add(params.turn.id);
      if (this.#terminal.size > 64) this.#terminal.delete(this.#terminal.values().next().value);
      const status = ['completed', 'interrupted', 'failed'].includes(params.turn.status) ? params.turn.status : 'unknown';
      if (status !== 'completed' && (this.#observer?.turnId === params.turn.id || this.#pending?.observerTurnId === params.turn.id)) this.#clearObserver();
      for (const item of this.#messages) if (item.turn === params.turn.id && item.status === 'streaming') item.status = status;
      if (status === 'completed' && this.#replyCandidate?.turnId === params.turn.id) {
        this.#replyCandidate.completed = true; this.#attachCompletedReply();
      }
      if (status === 'unknown') this.#error = 'conversation_completion_unknown';
      if (this.#stopping?.turn === params.turn.id) this.#stopping = undefined;
      this.#revision++; return;
    }
    const turn = this.#owner();
    if (!turn || params.turnId !== turn) return;
    if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') this.#update(params.itemId, turn, 'assistant', params.delta, true);
    if (['item/started', 'item/completed'].includes(method)) this.#item(params.item, turn, method === 'item/completed');
  }
  #item(item, turn, completed) {
    if (completed && item?.type === 'mcpToolCall' && item.server === 'fisch_live' && item.status === 'failed' &&
        ['compose_expression', 'express', 'playground_edit', 'return_to_face', 'cancel_expression'].includes(item.tool) &&
        (!this.#error || this.#error === 'conversation_expression_failed')) {
      this.#error = 'conversation_expression_failed'; this.#expressionFailureTurn = turn; this.#revision++;
    }
    if (item?.type === 'agentMessage' && typeof item.text === 'string') {
      this.#update(item.id, turn, 'assistant', item.text);
      if (completed && item.phase === 'final_answer' && id(item.id) &&
          (this.#observer?.turnId === turn || this.#pending?.observerTurnId === turn)) {
        const chars = Array.from(item.text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '));
        if (chars.join('').trim()) this.#replyCandidate = { turnId: turn, messageId: item.id,
          text: chars.slice(0, 480).join(''), truncated: chars.length > 480, completed: false };
      }
    }
    if (item?.type === 'userMessage' && Array.isArray(item.content)) {
      const owned = this.#ownedContexts.get(turn);
      const text = item.content.slice(0, 32).filter((value, index) => !(index === 1 && owned &&
        item.content[0]?.type === 'text' && item.content[0].text === owned.userText && value?.type === 'text' && value.text === owned.contextText))
        .filter(value => value?.type === 'text' && typeof value.text === 'string')
        .map(value => value.text.slice(0, 16000)).join('\n');
      this.#update(item.id, turn, 'user', text);
    }
  }
  #update(key, turn, role, text, delta = false) {
    if (!id(key) || !text) return;
    let item = this.#messages.find(value => value.id === key && value.turn === turn);
    if (!item) { item = { id: key, turn, role, text: '', status: 'streaming', truncated: false }; this.#messages.push(item); }
    if (item.role !== role) return;
    const length = (delta ? bytes(item.text) : 0) + bytes(text);
    item.text = clip(delta ? item.text + clip(text, 64000) : text, 64000);
    item.truncated = length > 64000 || (delta && item.truncated);
    while (this.#messages.length > 80 || this.#messages.reduce((sum, value) => sum + bytes(value.text), 0) > 128000) this.#messages.shift();
    this.#revision++;
  }
  snapshot() {
    this.#sync();
    return freeze({ generation: this.#generation, revision: this.#revision, ownerTurn: this.#owner() ?? null, available: !!this.#available(),
      canSend: !!this.#canSend(), canCancel: !!this.#owner() && !this.#stopping,
      pending: !!this.#pending, stopping: !!this.#stopping, waiting: this.#output.state === 'waiting',
      error: this.#unknown.has(this.#thread) ? 'conversation_unknown' : this.#unknown.size >= 64 ? 'conversation_capacity' : this.#error,
      messages: this.#messages.map(value => ({ ...value })) });
  }
}

export async function bindLiveConversation(page, conversation) {
  const expected = new URL(page.url()), frame = page.mainFrame();
  await page.exposeBinding('fischLiveConversation', (source, value) => {
    let current;
    try { current = new URL(source.frame.url()); } catch { throw failure('conversation_source_rejected'); }
    if (source.page !== page || source.frame !== frame || page.isClosed() || current.origin !== expected.origin ||
      current.pathname !== expected.pathname || current.search !== expected.search || !value || !['send', 'cancel', 'authorize_observer_context'].includes(value.action))
      throw failure('conversation_source_rejected');
    if (value.action === 'authorize_observer_context') {
      if (Object.keys(value).sort().join() !== 'action,requestId' || !id(value.requestId)) throw failure('conversation_source_rejected');
      return conversation.authorizeObserverContext?.(value.requestId) === true;
    }
    return value.action === 'send' ? conversation.send(value) : conversation.cancel(value);
  });
  const navigate = current => {
    if (current !== frame) return;
    let location;
    try { location = new URL(frame.url()); } catch { conversation.navigation(); return; }
    if (location.origin !== expected.origin || location.pathname !== expected.pathname || location.search !== expected.search)
      conversation.navigation();
  };
  const requested = request => {
    try { if (request.isNavigationRequest() && request.frame() === frame) conversation.navigation(); }
    catch { /* Detached or non-frame requests cannot identify this main frame. */ }
  };
  page.on('request', requested); page.on('framenavigated', navigate);
  return () => { page.off('request', requested); page.off('framenavigated', navigate); };
}
