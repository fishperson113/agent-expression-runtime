import { afterEach, expect, it, vi } from 'vitest';
import { VisionCamera } from '../src/live/vision';

function setup() {
  const track = { readyState: 'live', enabled: true, muted: false, onended: null, stop: vi.fn() };
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} });
  let tick = () => {}, encode: (value: Blob | null) => void = () => {};
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: vi.fn(fn => { encode = fn; }) };
  const doc = { hidden: false, createElement: vi.fn(() => canvas) }; vi.stubGlobal('document', doc);
  const video = { srcObject: null, readyState: 2, videoWidth: 1280, videoHeight: 720, play: async () => {},
    requestVideoFrameCallback: (fn: any) => { tick = () => fn(0, { mediaTime: 1 }); return 1; }, cancelVideoFrameCallback: () => {} };
  const camera = new VisionCamera(video as any, () => {}, () => {});
  return { camera, getUserMedia, track, doc, canvas, video, tick: () => tick(), encode: (blob = new Blob(['jpeg'], { type: 'image/jpeg' })) => encode(blob) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('never starts camera on read and rejects no-frame, hidden, stale, muted or ended streams', async () => {
  const t = setup(); expect(await t.camera.chatFrame()).toBeNull(); expect(t.getUserMedia).not.toHaveBeenCalled();
  await t.camera.start(); expect(await t.camera.chatFrame()).toBeNull(); t.tick();
  t.doc.hidden = true; expect(await t.camera.chatFrame()).toBeNull(); t.doc.hidden = false;
  t.track.muted = true; expect(await t.camera.chatFrame()).toBeNull(); t.track.muted = false;
  t.track.readyState = 'ended'; expect(await t.camera.chatFrame()).toBeNull(); t.track.readyState = 'live';
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1600); expect(await t.camera.chatFrame()).toBeNull(); now.mockRestore();
  expect(t.doc.createElement).not.toHaveBeenCalled(); t.camera.stop();
});
it('bounds encoding and returns original actual-frame acquisition metadata', async () => {
  const t = setup(); await t.camera.start(); t.tick(); const result = t.camera.chatFrame();
  expect(t.canvas.width).toBe(640); expect(t.canvas.height).toBe(360); expect(t.canvas.toBlob.mock.calls[0].slice(1)).toEqual(['image/jpeg', 0.65]);
  expect(await t.camera.chatFrame()).toBeNull(); t.encode();
  expect(await result).toMatchObject({ schemaVersion: 1, width: 640, height: 360, mediaTime: 1, url: 'data:image/jpeg;base64,anBlZw==' });
  expect(t.canvas.width).toBe(0); t.camera.stop();
});
it.each(['stop', 'restart', 'hidden', 'stale', 'oversize'])('rejects encoding invalidated by %s', async mode => {
  const t = setup(); await t.camera.start(); t.tick(); const result = t.camera.chatFrame();
  if (mode === 'stop') t.camera.stop(); if (mode === 'restart') { await t.camera.start(); t.tick(); }
  if (mode === 'hidden') t.doc.hidden = true;
  if (mode === 'stale') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1600);
  t.encode(mode === 'oversize' ? new Blob([new Uint8Array(192 * 1024 + 1)], { type: 'image/jpeg' }) : undefined);
  expect(await result).toBeNull(); t.camera.stop();
});
it('does not return a frame after permission denial', async () => {
  const t = setup(); t.getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
  await t.camera.start(); expect(await t.camera.chatFrame()).toBeNull(); expect(t.doc.createElement).not.toHaveBeenCalled();
});
