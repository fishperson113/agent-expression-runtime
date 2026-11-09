import { expect, it } from 'vitest';
import { HandGestures } from '../src/live/gestures';
const palm = [{ categoryName: 'Open_Palm', score: 0.9 }];
it('requires sustained confidence and rejects unknown/NaN/weak classes', () => {
  const hand = new HandGestures();
  for (const categoryName of ['None', 'injected', 'constructor']) expect(hand.update([{ categoryName, score: 1 }], 0)).toBe(null);
  expect(hand.update([{ categoryName: 'Open_Palm', score: NaN }], 1)).toBe(null);
  expect(hand.update([{ categoryName: 'Open_Palm', score: 0.74 }], 2)).toBe(null);
  expect(hand.update(palm, 100)).toBe(null); expect(hand.update(palm, 349)).toBe(null);
  expect(hand.update(palm, 350)).toBe('Xòe tay');
  hand.update([], 400); expect(hand.label(400)).toBe(null);
});
it('clears on reset, stale data and a changed hand pose without executing an effect', () => {
  const hand = new HandGestures(); hand.update(palm, 0); hand.update(palm, 250);
  expect(hand.label(750)).toBe('Xòe tay'); expect(hand.label(751)).toBe(null);
  expect(hand.update(palm, 1000)).toBe(null); expect(hand.update(palm, 1250)).toBe('Xòe tay');
  expect(hand.update([{ categoryName: 'Victory', score: 0.9 }], 1300)).toBe(null);
  hand.reset(); expect(hand.label(1400)).toBe(null);
});
it('reports each supported static pose without attaching geometry or inferred intent', () => {
  for (const categoryName of ['Closed_Fist', 'Pointing_Up', 'Thumb_Up', 'Thumb_Down', 'Victory', 'ILoveYou']) {
    const hand = new HandGestures(), category = [{ categoryName, score: 0.8 }];
    hand.update(category, 0); expect(hand.update(category, 250)).toBeTypeOf('string');
    expect(hand.label(751)).toBe(null);
  }
});
