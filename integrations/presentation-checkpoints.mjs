// Public transcript checkpoints only. This helper never reads tools or hidden reasoning.
const DEFAULTS = { minChars: 160, maxContextChars: 4096, maxSourceChars: 65536, cooldownMs: 1000 };

function options(value) {
  const result = { ...DEFAULTS, ...value };
  for (const [key, amount] of Object.entries(result)) {
    if (!(key in DEFAULTS) || !Number.isSafeInteger(amount) || amount < 0) throw new TypeError('checkpoint_options');
  }
  if (!result.minChars || result.maxContextChars < result.minChars || result.maxSourceChars < result.maxContextChars) throw new TypeError('checkpoint_bounds');
  return result;
}

function identityOf(input) {
  const values = ['documentId', 'threadId', 'turnId', 'messageId'].map(key => input[key]);
  if (values.some(value => typeof value !== 'string' || !value || value.length > 256)) throw new TypeError('checkpoint_identity');
  return JSON.stringify(values);
}

// Sentence ends are a conservative syntactic heuristic, not semantic certainty.
function boundaries(text, completed) {
  const ends = [];
  let fence = null;
  let offset = 0;
  let proseEnd = 0;
  for (const line of text.split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      offset += line.length + 1;
      continue;
    }
    if (!fence) {
      if (line.trim()) proseEnd = offset + line.trimEnd().length;
      for (const match of line.matchAll(/[.!?…。！？](?:["'”’)]*)(?=\s|$)/gu)) ends.push(offset + match.index + match[0].length);
      if (!line.trim() && proseEnd > 0) ends.push(offset);
    }
    offset += line.length + 1;
  }
  if (completed && !fence && proseEnd) ends.push(proseEnd);
  return ends;
}

function contextStart(text, end, limit) {
  let start = Math.max(0, end - limit);
  if (start && /[\uDC00-\uDFFF]/u.test(text[start])) start++;
  return start;
}

export class PublicTextCheckpoints {
  constructor(config = {}) {
    this.config = options(config);
    this.generation = 0;
    this.revision = 0;
    this.checkpointRevision = 0;
    this.identity = null;
    this.text = '';
    this.lastEnd = 0;
    this.lastEmittedAt = -Infinity;
    this.lastNow = -Infinity;
    this.lastChangedAt = null;
  }

  revoke(reason = 'explicit') {
    this.generation++;
    this.identity = null;
    this.text = '';
    this.lastEnd = 0;
    this.lastEmittedAt = -Infinity;
    return { revoked: true, reason, generation: this.generation, revision: this.revision, checkpoint: null };
  }

  update(input) {
    const identity = identityOf(input);
    if (typeof input.text !== 'string' || !Number.isFinite(input.at)) throw new TypeError('checkpoint_input');
    const now = Math.max(this.lastNow, input.at);
    this.lastNow = now;
    if (input.text.length > this.config.maxSourceChars) return this.revoke('source_limit');
    let reason = null;
    if (this.identity !== null && this.identity !== identity) reason = 'identity_changed';
    else if (this.identity === identity && !input.text.startsWith(this.text)) reason = 'text_corrected';
    if (reason) this.revoke(reason);
    if (this.identity !== identity || this.text !== input.text) {
      this.revision++;
      this.lastChangedAt = input.at;
    }
    this.identity = identity;
    this.text = input.text;
    const checkpoint = this.select(input, now);
    return { revoked: reason !== null, reason, generation: this.generation, revision: this.revision, checkpoint };
  }

  select(input, now) {
    if (now - this.lastEmittedAt < this.config.cooldownMs) return null;
    const end = boundaries(this.text, input.completed === true).at(-1) ?? 0;
    if (end - this.lastEnd < this.config.minChars) return null;
    const start = contextStart(this.text, end, this.config.maxContextChars);
    const checkpoint = Object.freeze({
      documentId: input.documentId, threadId: input.threadId,
      turnId: input.turnId, messageId: input.messageId,
      generation: this.generation, revision: this.revision,
      checkpointRevision: ++this.checkpointRevision,
      sourceStart: start, sourceEnd: end, previousEnd: this.lastEnd,
      sourceText: this.text.slice(start, end), textPrefix: this.text.slice(0, end),
      observedAt: this.lastChangedAt, selectedAt: now, completed: input.completed === true,
    });
    this.lastEnd = end;
    this.lastEmittedAt = now;
    return checkpoint;
  }

  compatible(checkpoint) {
    return Boolean(checkpoint && checkpoint.generation === this.generation
      && identityOf(checkpoint) === this.identity && this.text.startsWith(checkpoint.textPrefix));
  }
}
