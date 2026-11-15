import { expect, test } from 'vitest';
import { readVisualQuality, saveVisualQuality } from '../src/live/visual-quality';
test('visual quality is opt-in and defaults safely on malformed or unavailable storage', () => {
  for (const value of [null, '', '8001', 'Infinity', '8000.0', ' 8000', '2000'])
    expect(readVisualQuality(() => value)).toBe(2000);
  expect(readVisualQuality(() => '8000')).toBe(8000);
  expect(readVisualQuality(() => { throw Error('denied'); })).toBe(2000);
});
test('saving quality accepts only bounded choices and handles quota errors', () => {
  const writes: string[] = [];
  expect(saveVisualQuality('8000', value => { writes.push(value); })).toBe(true);
  expect(saveVisualQuality('2000', value => { writes.push(value); })).toBe(true);
  expect(saveVisualQuality('999999', value => { writes.push(value); })).toBe(false);
  expect(writes).toEqual(['8000', '2000']);
  expect(saveVisualQuality('8000', () => { throw Error('quota'); })).toBe(false);
});
