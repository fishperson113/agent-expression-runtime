import { expect, it } from 'vitest';
import { PlayDeck } from '../integrations/play-deck.mjs';

it('uses elapsed time, saves partial outcomes, and stops at the actual deadline', () => {
  const deck = new PlayDeck({ start: 100, minutes: 10, seed: 42 });
  expect(deck.next(100).id).toBeTypeOf('string');
  deck.record('completed', 1000);
  expect(deck.report(1100).elapsedMs).toBe(1000);
  expect(deck.report(1100).finished).toBe(false);
  expect(deck.report(600100).finished).toBe(true);
  expect(deck.report(600100).reason).toBe('deadline');
  expect(deck.next(600100)).toBeNull();
  expect(deck.report(600100).outcomes[0].outcome).toBe('completed');
});

it('retains missing outcomes as uncertain, rejects raw text and invalid ratings', () => {
  const deck = new PlayDeck({ start: 0, minutes: 20, seed: 42 });
  deck.next(0); deck.next(1);
  expect(deck.report(2).outcomes[0].outcome).toBe('uncertain');
  expect(() => deck.record('my private prompt', 3)).toThrow('outcome');
  for (const rating of [NaN, 0, 6, 1.5, '4']) expect(() => deck.rate(rating, 4, 4)).toThrow('rating');
  deck.rate(4, 3, 5); deck.finish(6, 'aborted');
  const report = deck.report(100);
  expect(report.elapsedMs).toBe(6);
  expect(report.reason).toBe('aborted');
  expect(report.ratings).toEqual({ enjoyment: 4, control: 3 });
  expect(JSON.stringify(report)).not.toMatch(/prompt|Có thể|private/);
});

it('is reproducible, bounds history, validates clocks and never auto-submits a prompt', () => {
  const a = new PlayDeck({ start: 0, minutes: 10, seed: 9011 });
  const b = new PlayDeck({ start: 0, minutes: 10, seed: 9011 });
  for (let i = 0; i < 150; i++) expect(a.next(i)).toEqual(b.next(i));
  expect(a.report(151).outcomes).toHaveLength(128);
  expect(a.report(151).discarded).toBe(22);
  expect(() => a.next(100)).toThrow('clock');
  expect(() => new PlayDeck({ start: 0, minutes: 9, seed: 1 })).toThrow('duration');
  expect(() => new PlayDeck({ start: NaN, minutes: 10, seed: 1 })).toThrow('clock');
});
