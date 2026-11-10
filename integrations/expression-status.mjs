import { subscribePlaygroundFeedback } from './playground-feedback.mjs';

const terminal = new Set(['completed', 'cancelled', 'rejected']);
const key = value => JSON.stringify([value.session, value.epoch, value.seq]);
export const expressionStatusTool = {
  name: 'expression_status',
  description: 'Read lifecycle evidence for this MCP process’s own requestId. Admission is not application or visibility. Completed covers the program and any active Live configured work, not persistent geometry, physical visibility or proof of an advertised wall-clock duration. Never reconnects or replays.',
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: { type: 'object', required: ['requestId'], additionalProperties: false,
    properties: { requestId: { type: 'string', minLength: 1, maxLength: 128 } } },
};

export function createExpressionStatus({ base, token, subscribe = subscribePlaygroundFeedback,
  now = () => performance.now(), limit = 256, ttlMs = 60000 }) {
  const entries = new Map(), feedback = new Map();
  let owner, stop, connected = false, generation = 0, closed = false;
  function prune(map) {
    const time = now();
    for (const [id, value] of map) if (time - value.updatedAt >= ttlMs) map.delete(id);
    while (map.size > limit) map.delete(map.keys().next().value);
  }
  function update(entry, value) {
    if (terminal.has(entry.status)) return;
    if (['accepted', 'pending'].includes(value.status) && entry.status === 'applied') return;
    entry.status = value.status; entry.updatedAt = now();
    if (['accepted', 'rejected'].includes(value.status)) entry.admission = value.status;
    entry.reason = undefined;
  }
  function lost(reason) {
    connected = false; generation++;
    for (const entry of entries.values()) if (!terminal.has(entry.status)) {
      entry.status = 'unknown'; entry.reason = reason; entry.updatedAt = now();
    }
    feedback.clear();
  }
  function receive(value) {
    prune(entries); prune(feedback);
    const id = key(value), previous = feedback.get(id);
    if (!previous) feedback.set(id, { ...value, updatedAt: now() });
    else update(previous, value);
    prune(feedback);
    for (const entry of entries.values()) if (entry.receipt && key(entry.receipt) === id) update(entry, feedback.get(id));
  }
  function reset(reason = 'session_changed') {
    const held = stop; stop = undefined; owner = undefined;
    lost(reason); held?.();
  }
  async function begin(requestId, session) {
    if (closed) throw Error('expression_status_closed');
    if (typeof requestId !== 'string' || !requestId.length || requestId.length > 128) throw Error('invalid_arguments');
    prune(entries);
    const previous = entries.get(requestId);
    if (previous && previous.sessionId !== session.id) {
      if (previous.admission !== undefined) throw Error('request_id_session_reused');
      entries.delete(requestId);
    }
    if (owner !== session.id) {
      reset(); owner = session.id;
      const tokenGeneration = generation;
      try {
        const subscription = await subscribe({ base, token, sessionId: owner,
          onFeedback: value => { if (tokenGeneration === generation) receive(value); },
          onLost: reason => { if (tokenGeneration === generation) lost(reason); } });
        if (closed || tokenGeneration !== generation) subscription();
        else { stop = subscription; connected = true; }
      }
      catch { if (tokenGeneration === generation) lost('feedback_unavailable'); }
    }
    if (closed) throw Error('expression_status_closed');
    if (!entries.has(requestId)) entries.set(requestId, { requestId, sessionId: session.id, status: 'unknown',
      reason: 'awaiting_admission', updatedAt: now() });
    prune(entries);
  }
  function receipt(requestId, value) {
    const entry = entries.get(requestId);
    if (!entry) return;
    if (value.session && value.epoch && Number.isSafeInteger(value.seq)) entry.receipt = {
      session: value.session, epoch: value.epoch, seq: value.seq };
    if (entry.admission === undefined || entry.admission === 'pending') entry.admission = value.status;
    update(entry, value);
    if (entry.receipt && connected && feedback.has(key(entry.receipt))) update(entry, feedback.get(key(entry.receipt)));
    if (!connected && !terminal.has(entry.status)) { entry.status = 'unknown'; entry.reason = 'feedback_unavailable'; }
  }
  function read(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 ||
        typeof args.requestId !== 'string' || !args.requestId.length || args.requestId.length > 128) throw Error('invalid_arguments');
    prune(entries); prune(feedback);
    const entry = entries.get(args.requestId);
    return entry ? { ...entry, sessionId: undefined, updatedAt: undefined, visibility: 'unknown' } : {
      requestId: args.requestId, status: 'unknown', reason: 'not_retained', visibility: 'unknown' };
  }
  function failed(requestId) {
    const entry = entries.get(requestId);
    if (entry && !terminal.has(entry.status)) { entry.status = 'unknown'; entry.reason = 'admission_unknown'; }
  }
  return { begin, receipt, read, reset, failed, close: () => { closed = true; reset('connection_closed'); } };
}
