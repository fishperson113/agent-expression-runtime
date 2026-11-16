import { expect, it } from 'vitest';
import { PublicParagraphSources } from '../integrations/presentation-paragraphs.mjs';
const a = 'A small seed beside the path can stand for another attempt, not proof that the previous experiment succeeded.';
const b = 'The fish can offer a quiet playful flourish while the conversation continues, without claiming to see the user.';
const base = { documentId: 'd', threadId: 'h', generation: 1, turnId: 't', messageId: 'm', role: 'assistant', at: 1000, completed: false, publicContext: '' };
const input = (text, extra = {}) => ({ ...base, text, ...extra });
it('waits for a blank-line or terminal closure, preserving exact paragraph and original time', () => {
  const s = new PublicParagraphSources();
  expect(s.update(input(a)).checkpoint).toBeNull();
  expect(s.update(input(a + '\n', { at: 1100 })).checkpoint).toBeNull();
  const cp = s.update(input(a + '\n\n', { at: 1200 })).checkpoint;
  expect(cp.target).toBe(a); expect(cp.textPrefix).toBe(a); expect(cp.sourceAt).toBe(1200);
  expect(new PublicParagraphSources().update(input(a, { completed: true })).checkpoint.target).toBe(a);
});
it('accepts long prose beyond the short sampler limit without slicing it', () => {
  const text = 'A considered explanation '.repeat(25) + 'remains a complete paragraph.';
  const cp = new PublicParagraphSources().update(input(text + '\n\n')).checkpoint;
  expect(text.length).toBeGreaterThan(320); expect(cp.target).toBe(text);
});
it('uses UTF16 exact offsets with CRLF, leading spaces and supplementary characters', () => {
  const text = 'Heading 😀\r\n\r\n  ' + a + '  \r\n\r\n';
  const cp = new PublicParagraphSources().update(input(text)).checkpoint;
  expect(cp.sourceStart).toBe(text.indexOf(a)); expect(cp.sourceEnd).toBe(text.indexOf(a) + a.length);
  expect(text.slice(cp.sourceStart, cp.sourceEnd)).toBe(a);
  expect(cp.textPrefix).toBe(text.slice(0, cp.sourceEnd));
});
it('skips fences, headings, lists, multiline blocks and unfinished sentences', () => {
  for (const text of ['```txt\n' + a + '\n\n```\n\n', '# ' + a + '\n\n', '- ' + a + '\n\n',
    '**' + a + '**\n\n', a + '\n' + b + '\n\n', a.slice(0, -1) + '\n\n', 'x'.repeat(1025) + '.\n\n'])
    expect(new PublicParagraphSources().update(input(text, { completed: true })).checkpoint).toBeNull();
});
it('keeps earliest closure of coalesced skipped quotes and never reissues an emitted quote', () => {
  const s = new PublicParagraphSources();
  expect(s.update(input(a + '\n\n' + b + '\n\n')).checkpoint.target).toBe(b);
  const repeat = s.update(input(a + '\n\n' + b + '\n\n' + a + '\n\n', { at: 5000 })).checkpoint;
  expect(repeat.sourceAt).toBe(1000); expect(repeat.selectedAt).toBe(5000);
  expect(s.update(input(a + '\n\n' + b + '\n\n' + a + '\n\n' + b + '\n\n', { at: 6000 })).checkpoint).toBeNull();
});
it('preserves all prior context and already-arrived suffix, with no context truncation', () => {
  const prior = 'Only if the pending measurement confirms it; this has not happened yet.';
  const suffix = 'This is a metaphor, not a claim of observed growth';
  const text = a + '\n\n' + suffix;
  const cp = new PublicParagraphSources().update(input(text, { publicContext: prior })).checkpoint;
  expect(cp.publicContext).toBe(prior + '\n\n' + text); expect(cp.textPrefix).toBe(a);
  expect(new PublicParagraphSources().update(input(a + '\n\n', { publicContext: 'x'.repeat(4096) })).checkpoint).toBeNull();
});
it('rejects malformed ownership and nonassistant text', () => {
  for (const extra of [{ role: 'user' }, { role: undefined }, { generation: undefined }, { generation: 1.5 },
    { generation: -1 }, { documentId: '' }, { completed: undefined }, { publicContext: undefined }, { at: NaN }]) {
    const s = new PublicParagraphSources(); s.update(input(a + '\n\n'));
    expect(s.update(input(a + '\n\n', extra)).revoked).toBe(true);
    expect(s.update(input(a + '\n\n', { at: 2000 })).checkpoint).toBeNull();
  }
});
it('retires corrected identities permanently including correction then reversion', () => {
  for (const extra of [{ text: b }, { publicContext: 'changed' }]) {
    const s = new PublicParagraphSources(); s.update(input(a + '\n\n'));
    expect(s.update(input(a + '\n\n', { at: 2000, ...extra })).revoked).toBe(true);
    expect(s.update(input(a + '\n\n', { at: 3000 })).checkpoint).toBeNull();
  }
});
it('revokes on terminal regression or appended text after completion', () => {
  for (const change of [{ completed: false }, { text: a + '\n\n' + b, completed: true }]) {
    const s = new PublicParagraphSources(); s.update(input(a, { completed: true }));
    expect(s.update(input(a, { at: 2000, ...change })).reason).toBe('terminal_regressed');
  }
});
it('detects an explicit correction marker even across stream chunks', () => {
  const s = new PublicParagraphSources(); s.update(input(a + '\n\nđính '));
  expect(s.update(input(a + '\n\nđính chính: ' + b, { at: 2000 })).reason).toBe('explicit_correction');
  expect(s.update(input(a + '\n\n', { at: 3000 })).checkpoint).toBeNull();
});
it('new generation or message retires the previous identity without resurrecting it', () => {
  for (const change of [{ generation: 2 }, { messageId: 'm2' }, { turnId: 't2' }, { threadId: 'h2' }, { documentId: 'd2' }]) {
    const s = new PublicParagraphSources(); s.update(input(a + '\n\n'));
    const next = s.update(input(b + '\n\n', { at: 2000, ...change }));
    expect(next.reason).toBe('identity_changed'); expect(next.checkpoint.target).toBe(b);
    expect(s.update(input(a + '\n\n', { at: 3000 })).checkpoint).toBeNull();
  }
});
it('clock regression revokes the identity and cannot renew its source age', () => {
  const s = new PublicParagraphSources(); s.update(input(a + '\n\n', { at: 2000 }));
  expect(s.update(input(a + '\n\n', { at: 1500 })).reason).toBe('clock_regressed');
  expect(s.update(input(a + '\n\n' + b + '\n\n', { at: 3000 })).checkpoint).toBeNull();
});
it('bounded quote memory cannot evict and resurrect old quotes', () => {
  const s = new PublicParagraphSources(); s.update(input(a + '\n\n'));
  for (let i = 0; i < 255; i++) s.firstSeen.set('reserved-' + i, 1);
  expect(s.update(input(a + '\n\n' + b + '\n\n', { at: 5000 })).checkpoint).toBeNull();
  expect(s.firstSeen.size).toBe(256); expect(s.firstSeen.get(a)).toBe(1000);
});
it('bounded retired identities do not evict and reactivate old messages', () => {
  const s = new PublicParagraphSources();
  for (let i = 0; i < 257; i++) s.update(input(a + '\n\n', { messageId: 'm' + i, at: i }));
  expect(s.retired.size).toBeLessThanOrEqual(257);
  expect(s.update(input(a + '\n\n', { messageId: 'm0', at: 300 })).checkpoint).toBeNull();
  expect(s.update(input(a + '\n\n', { messageId: 'fresh', at: 301 })).checkpoint).toBeNull();
});
it('accepts exactly 4096 context characters then permanently retires on one added character', () => {
  const s = new PublicParagraphSources();
  const text = a + '\n\n';
  const prior = 'x'.repeat(4096 - text.length - 2);
  const accepted = s.update(input(text, { publicContext: prior }));
  expect(accepted.checkpoint.publicContext.length).toBe(4096);
  const overflow = s.update(input(text + 'x', { publicContext: prior, at: 2000 }));
  expect(overflow).toEqual({ revoked: true, reason: 'context_limit', checkpoint: null });
  expect(s.update(input(text, { publicContext: prior, at: 3000 })).reason).toBe('source_retired');
  expect(s.update(input(b + '\n\n', { messageId: 'new', at: 4000 })).checkpoint.target).toBe(b);
});
it('overflow without a closed paragraph still revokes and cannot later become fresh', () => {
  const s = new PublicParagraphSources();
  expect(s.update(input('x'.repeat(4097))).reason).toBe('context_limit');
  expect(s.update(input(a + '\n\n', { at: 2000 })).reason).toBe('source_retired');
});
it('exact paragraph length bounds count UTF16 characters without slicing', () => {
  for (const length of [79, 80, 1024, 1025]) {
    const text = 'a'.repeat(length - 1) + '.';
    const cp = new PublicParagraphSources().update(input(text, { completed: true })).checkpoint;
    if (length === 80 || length === 1024) expect(cp.target).toBe(text);
    else expect(cp).toBeNull();
  }
});

it('does not expose the final line of wrapped CRLF or trailing-space paragraphs', () => {
  for (const separator of ['\r\n', '  \n', '\n']) {
    const text = 'This preceding line changes the interpretation.' + separator + a;
    for (const completed of [false, true])
      expect(new PublicParagraphSources().update(input(text + (completed ? '' : '\n\n'), { completed })).checkpoint).toBeNull();
  }
  const text = 'Short heading\r\n\t\r\n  ' + a + '\r\n\t\r\n';
  const cp = new PublicParagraphSources().update(input(text)).checkpoint;
  expect(cp.target).toBe(a); expect(cp.sourceStart).toBe(text.indexOf(a));
});

it('distinguishes Markdown blockquotes from ordinary quoted dialogue', () => {
  expect(new PublicParagraphSources().update(input('> ' + a + '\n\n')).checkpoint).toBeNull();
  const dialogue = '"' + a + '"';
  expect(new PublicParagraphSources().update(input(dialogue + '\n\n')).checkpoint.target).toBe(dialogue);
});
it('accepts bounded complete emoji graphemes without changing the source quote', () => {
  for (const suffix of ['\u{1f600}', '\u2764\ufe0f', '\u{1f44d}\u{1f3fd}', '\u{1f469}\u200d\u{1f4bb}', '\u{1f1fb}\u{1f1f3}', '1\ufe0f\u20e3', '\u{1f645}', '\u{1f600}'.repeat(8)]) {
    const quote = a + ' ' + suffix;
    const cp = new PublicParagraphSources().update(input(quote, { completed: true })).checkpoint;
    expect(cp.target).toBe(quote); expect(cp.sourceText).toBe(quote); expect(cp.publicContext).toBe(quote);
  }
});
it('does not treat words, malformed emoji, excessive emoji or unpunctuated text as closure', () => {
  for (const quote of [a + ' \u{1f600} ordinary', a + ' \u{1f600}\u200d', a + ' \ufe0f', a + ' \u{1f3fd}',
    a + ' \u{1f600}'.repeat(9), a.slice(0, -1) + ' \u{1f600}', '- ' + a + ' \u{1f600}'])
    expect(new PublicParagraphSources().update(input(quote, { completed: true })).checkpoint).toBeNull();
});
it('keeps emoji UTF16 spans, CRLF and first closure age without repeat renewal', () => {
  const quote = a + ' \u{1f469}\u200d\u{1f4bb} \u{1f645}';
  const text = 'Heading\r\n\r\n  ' + quote + '  \r\n\r\n';
  const s = new PublicParagraphSources(); const cp = s.update(input(text)).checkpoint;
  expect(cp.sourceStart).toBe(text.indexOf(quote)); expect(cp.sourceEnd).toBe(text.indexOf(quote) + quote.length);
  expect(text.slice(cp.sourceStart, cp.sourceEnd)).toBe(quote); expect(cp.sourceAt).toBe(1000);
  expect(s.update(input(text + quote + '\r\n\r\n', { at: 2000 })).checkpoint).toBeNull();
  expect(s.firstSeen.get(quote)).toBe(1000);
});
it('does not backdate emoji closure and retires its source on immediate turn2 or correction', () => {
  const quote = a + ' \u{1f469}\u200d\u{1f4bb}'; const s = new PublicParagraphSources();
  expect(s.update(input(a + ' \u{1f469}\u200d')).checkpoint).toBeNull();
  const cp = s.update(input(quote, { completed: true, at: 2000 })).checkpoint;
  expect(cp.sourceAt).toBe(2000); expect(cp.target).toBe(quote);
  const next = s.update(input('', { turnId: 't2', messageId: 'm2', at: 2001 }));
  expect(next).toEqual({ revoked: true, reason: 'identity_changed', checkpoint: null });
  expect(s.update(input(quote, { completed: true, at: 2002 })).reason).toBe('source_retired');
  const corrected = new PublicParagraphSources(); corrected.update(input(quote + '\n\n'));
  expect(corrected.update(input(a + ' \u{1f600}\n\n', { at: 2000 })).reason).toBe('text_corrected');
});
