import { expect, it } from 'vitest';
import { HandGestures } from '../src/live/gestures';
const palm = [{ categoryName: 'Open_Palm', score: 0.9 }];
it('requires sustained confidence, rejects unknown/NaN/weak classes and expires missing-hand motion', () => {
  const hand = new HandGestures();
  for (const categoryName of ['None', 'injected', 'constructor']) expect(hand.update([{ categoryName, score: 1 }], 0)).toBe(null);
  expect(hand.update([{ categoryName: 'Open_Palm', score: NaN }], 1)).toBe(null);
  expect(hand.update([{ categoryName: 'Open_Palm', score: 0.74 }], 2)).toBe(null);
  expect(hand.update(palm, 100)).toBe(null); expect(hand.update(palm, 349)).toBe(null);
  expect(hand.update(palm, 350)).toBe('Xòe tay');
  expect(hand.sample(850, 'normal')[0].value).toBeCloseTo(1.2);
  hand.update([], 900); expect(hand.sample(1350, 'normal')).toEqual([]);
});
it('bounds reaction cadence, clears on stop/reset and respects reduced/off modes', () => {
  const hand = new HandGestures(); hand.update(palm, 0); hand.update(palm, 250);
  expect(hand.update(palm, 500)).toBe(null);
  expect(hand.sample(750, 'off')).toEqual([]);
  expect(hand.sample(750, 'reduced')[0].value).toBeCloseTo(1.016);
  hand.reset(); expect(hand.sample(750, 'normal')).toEqual([]);
  expect(hand.update(palm, 1000)).toBe(null); expect(hand.update(palm, 2000)).toBe(null);
  expect(hand.update(palm, 2250)).toBe('Xòe tay');
});
it('recognizes each supported class without interpreting identity or intent', () => {
  for (const categoryName of ['Closed_Fist', 'Pointing_Up', 'Thumb_Up', 'Thumb_Down', 'Victory', 'ILoveYou']) {
    const hand = new HandGestures(), category = [{ categoryName, score: 0.8 }];
    hand.update(category, 0); expect(hand.update(category, 250)).toBeTypeOf('string');
    expect(hand.sample(750, 'normal')).toHaveLength(1);
    expect(hand.sample(1250, 'normal')).toEqual([]);
  }
});
