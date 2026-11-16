// Opt-in exact public prose only. Closure is syntax, not semantic entailment.
const LIMIT = 256;
const correction = /(?<![\p{L}\p{N}])(?:actually|correction|đính chính|nói đúng hơn)(?![\p{L}\p{N}])/giu;
function identityOf(input) {
  if (!input || input.role !== 'assistant' || !Number.isSafeInteger(input.generation) || input.generation < 0) return null;
  const keys = ['documentId', 'threadId', 'turnId', 'messageId'];
  if (keys.some(key => typeof input[key] !== 'string' || !input[key] || input[key].length > 256)) return null;
  return JSON.stringify([...keys.map(key => input[key]), input.generation, input.role]);
}
const emojiSegments = new Intl.Segmenter('und', { granularity: 'grapheme' });
const emojiCluster = /^(?:\p{RGI_Emoji})$/v;
function hasClosedSuffix(quote) {
  const punctuation = /[.!?。！？]["'”’)]*$/u;
  if (punctuation.test(quote)) return true;
  const clusters = [...emojiSegments.segment(quote)];
  let count = 0;
  for (let i = clusters.length - 1; i >= 0; i--) {
    const { segment, index } = clusters[i];
    if (/^[\t ]+$/u.test(segment)) continue;
    if (!emojiCluster.test(segment) || ++count > 8) break;
    if (punctuation.test(quote.slice(0, index).replace(/[\t ]+$/u, ''))) return true;
  }
  return false;
}
function eligible(raw) {
  const quote = raw.trim();
  return quote.length >= 80 && quote.length <= 1024 && !/[\r\n]/u.test(quote)
    && !/^\s*(?:#{1,6}\s|[-*+>]\s|\d+[.)]\s|\| |\*\*.*\*\*$|__.*__$)/u.test(quote)
    && hasClosedSuffix(quote);
}
function closedParagraphs(text, completed) {
  const result = []; let begin = 0, lines = [], fence = null;
  const flush = end => {
    const raw = text.slice(begin, end), quote = raw.trim();
    if (lines.length === 1 && eligible(raw)) {
      const start = begin + raw.indexOf(quote); result.push({ quote, start, end: start + quote.length });
    }
    lines = [];
  };
  for (const match of text.matchAll(/([^\n]*)(\n|$)/gu)) {
    if (!match[0]) continue;
    const line = match[1].replace(/\r$/u, ''), offset = match.index;
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (marker) {
      lines = [];
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    } else if (!fence && !line.trim()) { flush(offset); begin = offset + match[0].length; }
    else if (!fence) { if (!lines.length) begin = offset; lines.push(line); }
  }
  if (completed && !fence) flush(text.length);
  return result;
}
export class PublicParagraphSources {
  constructor() {
    this.serial = 0; this.lastNow = -Infinity; this.identity = null; this.retired = new Set();
    this.text = ''; this.context = ''; this.completed = false; this.firstSeen = new Map(); this.emitted = new Set();
  }
  revoke() {
    if (this.identity !== null) this.retired.add(this.identity);
    this.identity = null; this.text = ''; this.context = ''; this.completed = false;
    this.firstSeen.clear(); this.emitted.clear();
  }
  reject(reason) { this.revoke(); return { revoked: true, reason, checkpoint: null }; }
  begin(identity, input) {
    this.identity = identity; this.context = input.publicContext; this.text = ''; this.completed = false;
    this.firstSeen.clear(); this.emitted.clear();
  }
  update(input) {
    const identity = identityOf(input);
    if (!identity || typeof input.text !== 'string' || input.text.length > 64000
      || typeof input.publicContext !== 'string' || !Number.isFinite(input.at)
      || typeof input.completed !== 'boolean') return this.reject('source_invalid');
    if (input.at < this.lastNow) return this.reject('clock_regressed');
    this.lastNow = input.at;
    if (this.retired.has(identity) || this.retired.size >= LIMIT) return this.reject('source_retired');
    let reason = null;
    if (this.identity !== null && this.identity !== identity) { this.revoke(); reason = 'identity_changed'; }
    if (this.identity === null) this.begin(identity, input);
    if (input.publicContext !== this.context) return this.reject('context_corrected');
    if (!input.text.startsWith(this.text)) return this.reject('text_corrected');
    if (this.completed && (!input.completed || input.text !== this.text)) return this.reject('terminal_regressed');
    const oldLength = this.text.length;
    const corrections = [...input.text.matchAll(correction)];
    if (corrections.some(match => match.index + match[0].length > oldLength)) return this.reject('explicit_correction');
    this.text = input.text; this.completed = input.completed;
    const candidates = this.observe(closedParagraphs(input.text, input.completed), input.at);
    const candidate = candidates.at(-1);
    const publicContext = input.publicContext ? input.publicContext + '\n\n' + input.text : input.text;
    if (publicContext.length > 4096) return this.reject('context_limit');
    if (!candidate || this.emitted.has(candidate.quote))
      return { revoked: !!reason, reason, checkpoint: null };
    this.emitted.add(candidate.quote);
    return { revoked: !!reason, reason, checkpoint: { ...input, publicContext, checkpointRevision: ++this.serial,
      sourceStart: candidate.start, sourceEnd: candidate.end, previousEnd: 0, sourceText: candidate.quote,
      target: candidate.quote, textPrefix: input.text.slice(0, candidate.end), sourceAt: candidate.sourceAt,
      observedAt: candidate.sourceAt, selectedAt: input.at } };
  }
  observe(paragraphs, at) {
    const candidates = [];
    for (const paragraph of paragraphs) {
      if (!this.firstSeen.has(paragraph.quote)) {
        if (this.firstSeen.size >= LIMIT) continue;
        this.firstSeen.set(paragraph.quote, at);
      }
      candidates.push({ ...paragraph, sourceAt: this.firstSeen.get(paragraph.quote) });
    }
    return candidates;
  }
}

