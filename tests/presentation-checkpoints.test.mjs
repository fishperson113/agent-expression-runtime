import { describe, it, expect } from 'vitest';
import { PublicTextCheckpoints } from '../integrations/presentation-checkpoints.mjs';
const identity = { documentId: 'd', threadId: 't', turnId: 'u', messageId: 'm' };
const input = (text, at = 0, extra = {}) => ({ ...identity, text, at, ...extra });
const make = (extra = {}) => new PublicTextCheckpoints({ minChars: 12, maxContextChars: 60, maxSourceChars: 200, cooldownMs: 100, ...extra });

describe('public text checkpoints', () => {
  it('waits for coherent text and suppresses tiny/repeated updates', () => {
    const helper = make();
    expect(helper.update(input('hello')).checkpoint).toBeNull();
    expect(helper.update(input('hello this is still incomplete')).checkpoint).toBeNull();
    const result = helper.update(input('hello this is complete.'));
    expect(result.checkpoint.sourceText).toBe('hello this is complete.');
    expect(helper.update(input('hello this is complete.', 200)).checkpoint).toBeNull();
  });
  it('does not revoke a compatible prefix when text appends or a newer checkpoint emits', () => {
    const helper = make();
    const first = helper.update(input('First sentence here.')).checkpoint;
    const next = helper.update(input('First sentence here. Second sentence here.', 200));
    expect(next.revoked).toBe(false);
    expect(next.checkpoint.checkpointRevision).toBeGreaterThan(first.checkpointRevision);
    expect(next.checkpoint.previousEnd).toBe(first.sourceEnd);
    expect(helper.compatible(first)).toBe(true);
  });
  it('revokes on corrections and identity changes', () => {
    const helper = make();
    const first = helper.update(input('First sentence here.')).checkpoint;
    const corrected = helper.update(input('Different sentence here.', 200));
    expect(corrected.reason).toBe('text_corrected');
    expect(helper.compatible(first)).toBe(false);
    const switched = helper.update(input('Different sentence here.', 300, { turnId: 'next' }));
    expect(switched.reason).toBe('identity_changed');
    expect(helper.compatible(corrected.checkpoint)).toBe(false);
  });
  it('coalesces newest coherent boundary on cooldown without a new text delta', () => {
    const helper = make();
    helper.update(input('First sentence here.'));
    const text = 'First sentence here. Second sentence here. Third sentence here.';
    expect(helper.update(input(text, 50)).checkpoint).toBeNull();
    const later = helper.update(input(text, 100));
    expect(later.checkpoint.textPrefix).toBe(text);
    expect(later.checkpoint.observedAt).toBe(50);
    expect(later.checkpoint.selectedAt).toBe(100);
    expect(later.checkpoint.sourceText.length).toBeLessThanOrEqual(60);
  });
  it('ignores sentence-like content within fenced code, including incomplete fences', () => {
    const helper = make();
    const fenced = '```js\nthis.looks.like.a.sentence!\n';
    expect(helper.update(input(fenced, 0, { completed: true })).checkpoint).toBeNull();
    expect(make().update(input(fenced + '```\n\n', 0, { completed: true })).checkpoint).toBeNull();
    const closed = fenced + '```\nActual explanation here.';
    expect(helper.update(input(closed, 100)).checkpoint.sourceEnd).toBe(closed.length);
  });
  it('supports paragraph boundaries, Vietnamese and final unpunctuated prose', () => {
    const helper = make();
    const text = 'Đây là một ý hoàn chỉnh\n\n';
    expect(helper.update(input(text)).checkpoint).not.toBeNull();
    const final = make().update(input('Một câu không chấm cuối', 0, { completed: true }));
    expect(final.checkpoint.sourceText).toBe('Một câu không chấm cuối');
  });
  it('bounds source memory and revokes existing checkpoints on overflow', () => {
    const helper = make();
    const checkpoint = helper.update(input('First sentence here.')).checkpoint;
    expect(helper.update(input('x'.repeat(201), 100)).reason).toBe('source_limit');
    expect(helper.text).toBe('');
    expect(helper.compatible(checkpoint)).toBe(false);
  });
  it('uses monotonic selection time and immutable bounded context with UTF16 offsets', () => {
    const helper = make({ maxContextChars: 13 });
    const first = helper.update(input('😀😀😀😀😀😀 explanation.', 100)).checkpoint;
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.sourceText.length).toBeLessThanOrEqual(13);
    expect(/[\uDC00-\uDFFF]/u.test(first.sourceText[0])).toBe(false);
    expect(helper.update(input('😀😀😀😀😀😀 explanation. More explanation.', 0)).checkpoint).toBeNull();
  });
  it('validates options and accepts no unbounded identity', () => {
    expect(() => make({ minChars: 0 })).toThrow();
    expect(() => make({ surprise: 1 })).toThrow();
    expect(() => make().update(input('text', 0, { threadId: '' }))).toThrow();
  });
});
