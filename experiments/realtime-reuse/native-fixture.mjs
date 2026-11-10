// Public synthetic app-server only. This does not invoke Codex or a model.
import { createHash } from 'node:crypto';

const histories = new Map();
const turns = new Map();
const flags = { hold: false, malformed: false, reorder: false, delayedAck: false };
let serial = 0;
let interruptCalls = 0;
let buffer = '';
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');

function finish(id, status) {
  const turn = turns.get(id);
  if (!turn || turn.done) return;
  turn.done = true;
  const history = histories.get(turn.threadId);
  history.push({ role: 'assistant', content: 'Public scripted ' + status });
  if (history.length > 32) history.splice(0, history.length - 32);
  emit({ method: 'turn/completed', params: { threadId: turn.threadId, turn: { id, status } } });
}

function start(message) {
  const { threadId, input } = message.params;
  if (!histories.has(threadId) && histories.size >= 4) throw Error('fixture_session_capacity');
  const history = histories.get(threadId) ?? [];
  const turnId = 'public-turn-' + ++serial;
  const first = history.find(value => value.role === 'user');
  emit({ method: 'test/context', params: {
    threadId, turnId,
    priorUserCount: history.filter(value => value.role === 'user').length,
    priorRoles: history.map(value => value.role),
    firstUserHash: first ? createHash('sha256').update(first.content).digest('hex') : null,
  } });
  history.push({ role: 'user', content: input[0].text });
  histories.set(threadId, history);
  turns.set(turnId, { threadId, done: false });
  if (turns.size > 64) turns.delete(turns.keys().next().value);
  if (flags.reorder) { reordered(message, turnId); return; }
  if (flags.delayedAck) {
    flags.delayedAck = false;
    setTimeout(() => emit({ id: message.id, result: { turn: { id: turnId, status: 'inProgress' } } }), 50);
    return;
  }
  emit({ id: message.id, result: { turn: { id: turnId, status: flags.malformed ? 'future_status' : 'inProgress' } } });
  if (flags.malformed) { flags.malformed = false; return; }
  emit({ method: 'item/agentMessage/delta', params: {
    threadId, turnId, itemId: 'message-' + turnId,
    delta: 'Public scripted reply; prior user turns=' + (history.filter(value => value.role === 'user').length - 1),
  } });
  if (flags.hold) { flags.hold = false; return; }
  setTimeout(() => finish(turnId, 'completed'), 10);
}

function reordered(message, turnId) {
  flags.reorder = false;
  const threadId = message.params.threadId;
  emit({ method: 'turn/started', params: { threadId, turn: { id: turnId } } });
  finish(turnId, 'completed');
  emit({ method: 'turn/started', params: { threadId, turn: { id: 'public-newer-before-ack' } } });
  setTimeout(() => emit({ id: message.id, result: { turn: { id: turnId, status: 'completed' } } }), 10);
}

function interrupt(message) {
  interruptCalls++;
  const { threadId, turnId } = message.params;
  emit({ id: message.id, result: {} });
  if (turns.has(turnId)) finish(turnId, 'interrupted');
  else emit({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted' } } });
  setTimeout(() => {
    emit({ method: 'turn/started', params: { threadId, turn: { id: turnId } } });
    emit({ method: 'item/agentMessage/delta', params: {
      threadId, turnId, itemId: 'late-item', delta: 'PUBLIC_STALE_CALLBACK',
    } });
  }, 20);
}

function request(message) {
  const { method, params = {} } = message;
  if (method === 'thread/resume') {
    emit({ id: message.id, result: { thread: { id: params.threadId } } }); return;
  }
  if (['test/hold', 'test/malformed', 'test/reorder', 'test/delayedAck'].includes(method)) {
    flags[method.slice(5)] = true; emit({ id: message.id, result: {} }); return;
  }
  if (method === 'test/stats') {
    emit({ id: message.id, result: { interruptCalls } }); return;
  }
  if (method === 'test/newer') {
    emit({ method: 'turn/started', params: { threadId: params.threadId, turn: { id: 'public-newer-same-generation' } } });
    emit({ id: message.id, result: {} }); return;
  }
  if (method === 'turn/start') { start(message); return; }
  if (method === 'turn/interrupt') { interrupt(message); return; }
  emit({ id: message.id, error: { code: -32601, message: 'fixture_method' } });
}

process.stdin.on('data', chunk => {
  buffer += chunk;
  if (buffer.length > 65536) { process.exitCode = 2; process.stdin.destroy(); return; }
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    request(JSON.parse(line));
  }
});
