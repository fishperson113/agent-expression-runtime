import { afterEach, expect, it, vi } from 'vitest';
import { VisionCamera } from '../src/live/vision';

function harness() {
  const instances: any[] = [], tracks: any[] = [], statuses: string[] = [];
  class FakeWorker {
    onmessage?: (event: any) => void; onerror?: () => void;
    postMessage = vi.fn(); terminate = vi.fn();
    constructor() { instances.push(this); }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const getUserMedia = vi.fn(async (options: any) => {
    expect(options.audio).toBe(false);
    const track: any = { onended: null, stop: vi.fn() }; tracks.push(track);
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const video = { srcObject: null, play: async () => {}, requestVideoFrameCallback: vi.fn(() => 1), cancelVideoFrameCallback: vi.fn() } as unknown as HTMLVideoElement;
  const camera = new VisionCamera(video, () => {}, status => statuses.push(status));
  return { camera, video, instances, tracks, statuses, getUserMedia };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('retries an externally ended GPU track once with CPU and releases the old stream', async () => {
  vi.useFakeTimers(); const test = harness(); await test.camera.start();
  test.tracks[0].onended(); expect(test.statuses).toContain('recovering-CPU');
  expect(test.tracks[0].stop).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(500);
  expect(test.instances[1].postMessage).toHaveBeenCalledWith({ type: 'init', delegate: 'CPU' });
  test.tracks[1].onended(); await vi.advanceTimersByTimeAsync(500);
  expect(test.getUserMedia).toHaveBeenCalledTimes(2); expect(test.statuses.at(-1)).toBe('stopped');
  test.camera.stop(); expect(test.video.srcObject).toBe(null);
});
it('honors manual stop during recovery and never reopens the camera afterwards', async () => {
  vi.useFakeTimers(); const test = harness(); await test.camera.start();
  test.tracks[0].onended(); test.camera.stop(); await vi.advanceTimersByTimeAsync(1000);
  expect(test.getUserMedia).toHaveBeenCalledOnce(); expect(test.video.srcObject).toBe(null);
});
