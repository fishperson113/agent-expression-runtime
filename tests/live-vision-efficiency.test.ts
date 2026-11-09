import { expect, it, vi } from 'vitest';
import { selectVisionDelegate } from '../src/live/vision-delegate';
import { drawLandmarkOverlay } from '../src/live/landmark-overlay';

function gpu(renderer: string | null) {
  const loseContext = vi.fn(), context = { getParameter: () => renderer,
    getExtension: (name: string) => name === 'WEBGL_debug_renderer_info' ? renderer === null ? null : { UNMASKED_RENDERER_WEBGL: 1 } : { loseContext } };
  return { create: () => ({ getContext: () => context }) as any, loseContext };
}
it('uses CPU for measured SwiftShader while retaining native/unknown GPU and releasing query contexts', () => {
  for (const [name, expected] of [['ANGLE SwiftShader Device', 'CPU'], ['ANGLE AMD Radeon', 'GPU'], [null, 'GPU']] as const) {
    const device = gpu(name);
    expect(selectVisionDelegate('GPU', device.create)).toBe(expected);
    expect(device.loseContext).toHaveBeenCalledOnce();
  }
});
it('honors explicit CPU without opening a GPU context and tolerates unavailable renderer metadata', () => {
  const create = vi.fn(() => { throw Error('unavailable'); });
  expect(selectVisionDelegate('CPU', create)).toBe('CPU'); expect(create).not.toHaveBeenCalled();
  expect(selectVisionDelegate('GPU', create)).toBe('GPU');
});
it('keeps overlay allocation stable, preserves marker coordinates and clears stale markers when hidden', () => {
  let width = 300, height = 150; const sizes: number[] = [], context = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
  const canvas = { get width() { return width; }, set width(value) { sizes.push(value); width = value; },
    get height() { return height; }, set height(value) { sizes.push(value); height = value; }, getContext: () => context } as any;
  const points = [{ x: 0.5, y: 0.25 }, { x: 0.25, y: 0.5 }];
  drawLandmarkOverlay(canvas, points, true); drawLandmarkOverlay(canvas, points, true);
  expect(sizes).toEqual([640, 480]); expect(context.fillRect).toHaveBeenCalledTimes(4);
  expect(context.fillRect).toHaveBeenCalledWith(320, 120, 2, 2); expect(context.fillRect).toHaveBeenCalledWith(160, 240, 2, 2);
  drawLandmarkOverlay(canvas, points, false);
  expect(context.fillRect).toHaveBeenCalledTimes(4); expect(context.clearRect).toHaveBeenCalledTimes(3);
});
