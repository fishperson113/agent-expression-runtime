import { expect, it } from 'vitest';
import { MotionPhase } from '../src/adapters/motion-phase';
it('changes speed continuously after long uptime and retains orientation across fields', () => {
  const p = new MotionPhase();
  p.advance(600000, 0.15);
  const before = p.advance(600016, 0.15);
  const after = p.advance(600032, 0.35);
  expect(after - before).toBeCloseTo(0.016 * 0.35 * 0.35);
  expect(p.advance(600048, 0)).toBe(after);
  expect(p.advance(600064, 0.35) - after).toBeCloseTo(0.016 * 0.35 * 0.35);
});
it('bounds restore catchup and ignores backwards clock movement', () => {
  const p = new MotionPhase();
  p.advance(0, 1);
  expect(p.advance(600000, 1)).toBeCloseTo(0.035);
  expect(p.advance(1, 1)).toBeCloseTo(0.035);
});
