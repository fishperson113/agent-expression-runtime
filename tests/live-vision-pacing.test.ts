import { afterEach, expect, it, vi } from 'vitest';
import { VisionCamera } from '../src/live/vision';

function setup() {
  const workers: any[] = [], track = { stop: vi.fn(), onended: null };
  class FakeWorker {
    postMessage = vi.fn(); terminate = vi.fn(); onmessage?: (event: any) => void;
    constructor() { workers.push(this); }
  }
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }) } });
  const bitmap = { close: vi.fn() }, create = vi.fn(async () => bitmap); vi.stubGlobal('createImageBitmap', create);
  let callback = () => {};
  const video = { currentTime: 1, srcObject: null, play: async () => {},
    requestVideoFrameCallback: vi.fn(fn => { callback = () => fn(0, { mediaTime: video.currentTime }); return 1; }), cancelVideoFrameCallback: vi.fn() };
  const receive = vi.fn();
  const camera = new VisionCamera(video as any, receive, () => {});
  return { camera, video, workers, create, bitmap, receive, tick: () => callback(), sample: () => workers.at(-1).onmessage({ data: { type: 'sample', frameId: workers.at(-1).postMessage.mock.calls.at(-1)[0].frameId, sample: {} } }) };
}
afterEach(() => { vi.unstubAllGlobals(); });
it('processes the freshest available frame after a slow result without queuing or repeating a delivered media timestamp', async () => {
  const t = setup(); await t.camera.start(); t.workers[0].onmessage({ data: { type: 'ready', delegate: 'CPU' } });
  t.tick(); await Promise.resolve(); expect(t.create).toHaveBeenCalledTimes(1);
  t.video.currentTime = 2; t.tick(); t.video.currentTime = 3; t.tick();
  expect(t.create).toHaveBeenCalledTimes(1);
  t.sample(); await Promise.resolve(); expect(t.create).toHaveBeenCalledTimes(2);
  expect(t.workers[0].postMessage.mock.calls.filter(([message]: any[]) => message.type === 'frame')).toHaveLength(2);
  t.video.currentTime = 4; t.sample(); await Promise.resolve(); expect(t.create).toHaveBeenCalledTimes(2);
  t.tick(); await Promise.resolve(); expect(t.create).toHaveBeenCalledTimes(3);
  t.camera.stop();
});
it('closes a capture that resolves after stop and never submits it to a retired worker', async () => {
  const t = setup(); let resolve!: (value: any) => void;
  t.create.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await t.camera.start(); t.workers[0].onmessage({ data: { type: 'ready', delegate: 'CPU' } });
  t.tick(); t.camera.stop(); resolve(t.bitmap); await Promise.resolve();
  expect(t.bitmap.close).toHaveBeenCalledOnce();
  expect(t.workers[0].postMessage).toHaveBeenCalledTimes(1);
  t.workers[0].onmessage({ data: { type: 'sample', frameId: 1, sample: {} } }); expect(t.create).toHaveBeenCalledTimes(1);
});
it('does not release a new session capture when an older capture rejects', async () => {
  const t = setup(); let reject!: () => void;
  t.create.mockImplementationOnce(() => new Promise((_, fail) => { reject = () => fail(Error('old')); }));
  await t.camera.start(); t.workers[0].onmessage({ data: { type: 'ready', delegate: 'CPU' } }); t.tick();
  await t.camera.start(); t.workers[1].onmessage({ data: { type: 'ready', delegate: 'CPU' } });
  t.tick(); await Promise.resolve(); reject(); await Promise.resolve();
  t.video.currentTime = 2; t.tick(); expect(t.create).toHaveBeenCalledTimes(2); t.camera.stop();
});

it('releases an untransferred bitmap on post failure and accepts a later fresh frame', async () => {
  const t = setup(); await t.camera.start(); t.workers[0].onmessage({ data: { type: 'ready', delegate: 'CPU' } });
  t.workers[0].postMessage.mockImplementationOnce(() => { throw Error('post_failed'); });
  t.tick(); await Promise.resolve(); expect(t.bitmap.close).toHaveBeenCalledOnce();
  t.video.currentTime = 2; t.tick(); await Promise.resolve(); expect(t.create).toHaveBeenCalledTimes(2);
  expect(t.workers[0].postMessage.mock.calls.at(-1)[0].type).toBe('frame'); t.camera.stop();
});

it('ignores a retired worker error after a newer camera session starts', async () => {
  const t = setup(); await t.camera.start(); const old = t.workers[0];
  await t.camera.start(); old.onerror();
  expect(t.workers[1].terminate).not.toHaveBeenCalled(); expect(t.video.srcObject).not.toBeNull(); t.camera.stop();
});

it('keeps acquisition time through delayed inference and ignores a duplicate old-frame result', async () => {
  const t = setup(), now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  await t.camera.start(); t.workers[0].onmessage({ data: { type: 'ready', delegate: 'CPU' } });
  t.tick(); await Promise.resolve(); const first = t.workers[0].postMessage.mock.calls.at(-1)[0].frameId;
  now.mockReturnValue(1200); t.video.currentTime = 2; t.tick(); now.mockReturnValue(1800); t.sample(); await Promise.resolve();
  expect(t.receive.mock.calls[0][0].sourceFrame).toEqual({ availableAt: 1000, requestedAt: 1000, mediaTime: 1 });
  t.workers[0].onmessage({ data: { type: 'sample', frameId: first, sample: {} } });
  expect(t.receive).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1900); t.sample();
  expect(t.receive.mock.calls[1][0].sourceFrame).toEqual({ availableAt: 1200, requestedAt: 1800, mediaTime: 2 });
  t.camera.stop(); now.mockRestore();
});
