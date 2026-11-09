const operations = ['create', 'remix', 'undo', 'reset', 'recover'];
const tools = ['playground_edit', 'playground_state'];
const stages = ['proposed', 'pending', 'admitted', 'desynchronized'];
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const initial = () => ({ status: 'unknown', revision: 0, scenes: 0, recoveryRequired: false });
const metadata = ({ operation, ...value }) => value;
const remember = (set, value) => { set.add(value); if (set.size > 64) set.delete(set.values().next().value); };

function content(item) {
  const result = item.result;
  if (item.error != null || !['completed', 'failed'].includes(item.status) || !result ||
      !Array.isArray(result.content) || result.content.length !== 1 || result.content[0]?.type !== 'text' ||
      typeof result.content[0].text !== 'string' || Buffer.byteLength(result.content[0].text, 'utf8') > 65536) return null;
  let value;
  try { value = JSON.parse(result.content[0].text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Number.isInteger(value.scenes) || value.scenes < 0 || value.scenes > 12 || typeof value.recoveryRequired !== 'boolean' ||
      typeof value.closed !== 'boolean' || (value.pending !== null &&
        (!value.pending || typeof value.pending !== 'object' || !stages.includes(value.pending.stage)))) return null;
  return { value, failed: item.status === 'failed' || result.isError === true };
}

function outcome(item, call) {
  const parsed = content(item); if (!parsed) return null;
  const { value: v, failed } = parsed;
  let status;
  if (item.tool === 'playground_state') {
    if (failed || v.status !== undefined) return null;
    status = v.recoveryRequired || v.closed || v.pending?.stage === 'desynchronized' ? 'uncertain'
      : v.pending ? 'working' : v.scenes ? 'stored' : 'empty';
  } else if (['uncertain', 'rejected'].includes(v.status)) status = 'uncertain';
  else if (!failed && !v.recoveryRequired && !v.closed && v.pending === null) {
    if (v.status === 'committed' && operations.slice(0, 4).includes(call.operation) && v.scenes > 0 && v.revision > 0) status = 'stored';
    if (v.status === 'recovered' && call.operation === 'recover' && v.scenes === 0 && v.revision === 0) status = 'recovered';
  }
  return status ? { status, revision: v.revision, scenes: v.scenes, recoveryRequired: v.recoveryRequired,
    ...(call.operation ? { operation: call.operation } : {}) } : null;
}

export class PlaygroundProjection {
  #thread; #turn; #calls = new Map(); #items = new Set(); #turns = new Set();
  #dto = initial(); #order = 0; #published = 0; #recoveryOrder = 0; #recovering = 0; #overflow = false;
  select(thread) {
    if (!identity(thread) || thread === this.#thread) return null;
    this.#thread = thread; this.#turn = undefined; this.#calls.clear(); this.#items.clear(); this.#turns.clear();
    this.#dto = initial(); this.#order = this.#published = this.#recoveryOrder = this.#recovering = 0; this.#overflow = false;
    return { ...this.#dto };
  }
  #publish(value, order) {
    if (order < this.#recoveryOrder) return null;
    if (order < this.#published && value.revision <= this.#dto.revision) return null;
    if (value.revision < this.#dto.revision && value.status !== 'recovered' && !value.recoveryRequired) return null;
    this.#published = Math.max(this.#published, order);
    const equal = Object.keys(value).length === Object.keys(this.#dto).length && Object.keys(value).every(key => value[key] === this.#dto[key]);
    this.#dto = { ...value }; return equal ? null : { ...this.#dto };
  }
  #turnEvent(method, params) {
    const id = params.turn?.id; if (!identity(id)) return null;
    if (method === 'turn/started') {
      if (this.#turns.has(id) || id === this.#turn) return null;
      if (this.#turn) remember(this.#turns, this.#turn);
      const pending = this.#calls.size > 0;
      this.#turn = id; this.#calls.clear(); this.#items.clear(); this.#recovering = 0; this.#overflow = false;
      return pending ? this.#publish({ ...this.#dto, status: 'interrupted' }, ++this.#order) : null;
    }
    if (id !== this.#turn) return null;
    remember(this.#turns, id); this.#turn = undefined;
    const pending = this.#calls.size > 0; this.#calls.clear(); this.#recovering = 0;
    return pending ? this.#publish({ ...this.#dto, status: params.turn.status === 'interrupted' ? 'interrupted' : 'uncertain' }, ++this.#order) : null;
  }
  accept(message) {
    const { method, params } = message ?? {};
    if (!this.#thread || !params || params.threadId !== this.#thread) return null;
    if (['turn/started', 'turn/completed'].includes(method)) return this.#turnEvent(method, params);
    if (!this.#turn || params.turnId !== this.#turn || this.#overflow || !['item/started', 'item/completed'].includes(method)) return null;
    const item = params.item;
    if (!item || item.type !== 'mcpToolCall' || item.server !== 'fisch_live' || !tools.includes(item.tool) || !identity(item.id) || this.#items.has(item.id)) return null;
    if (method === 'item/started') return this.#start(item);
    const call = this.#calls.get(item.id); if (!call || call.tool !== item.tool) return null;
    this.#calls.delete(item.id); remember(this.#items, item.id);
    if (this.#recovering && call.order !== this.#recovering) return null;
    const value = outcome(item, call) ?? { ...metadata(this.#dto), status: 'uncertain', ...(call.operation ? { operation: call.operation } : {}) };
    let order = call.order;
    if (call.order === this.#recovering) {
      this.#recovering = 0; order = this.#recoveryOrder = ++this.#order;
      for (const id of this.#calls.keys()) remember(this.#items, id);
      this.#calls.clear();
    }
    return this.#publish(value, order);
  }
  #start(item) {
    if (item.status !== 'inProgress' || this.#calls.has(item.id)) return null;
    if (this.#calls.size >= 32) {
      this.#overflow = true; this.#calls.clear();
      return this.#publish({ ...this.#dto, status: 'uncertain' }, ++this.#order);
    }
    const operation = item.tool === 'playground_edit' && operations.includes(item.arguments?.operation) ? item.arguments.operation : undefined;
    const call = { tool: item.tool, operation, order: ++this.#order }; this.#calls.set(item.id, call);
    if (operation === 'recover') this.#recovering = this.#recoveryOrder = call.order;
    else if (this.#recovering) return null;
    return this.#publish({ ...metadata(this.#dto), status: 'working', ...(operation ? { operation } : {}) }, call.order);
  }
}
