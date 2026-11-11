import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
const encoder = vi.hoisted(() => ({ calls: [], error: null, delayMs: 80 }));
vi.mock('node:child_process', async original => ({ ...await original(),
  execFile: vi.fn((file, args, callback) => {
    encoder.calls.push({ file, args }); const child = new EventEmitter();
    setTimeout(() => callback(encoder.error, '', ''), encoder.delayMs); return child;
  }),
  execFileSync: vi.fn(() => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, encoder.delayMs); return Buffer.alloc(0); }),
}));
import { startBodyVideo, finishBodyVideo } from '../integrations/live-holdout-video.mjs';
let directory, capture, tracks, settings, recorders;
class Recorder extends EventTarget {
  state = 'inactive'; onstop; onerror; ondataavailable;
  constructor(stream, options) {
    super(); if (settings.constructorError) throw Error('fixture_constructor');
    this.stream = stream; this.options = options; recorders.push(this);
  }
  start() { if (settings.startError) throw Error('fixture_start'); this.state = 'recording'; }
  stop() {
    if (settings.stopError) throw Error('fixture_stop');
    if (this.state === 'inactive') throw Error('fixture_already_stopped'); this.state = 'inactive';
    queueMicrotask(() => { this.onstop?.(); this.dispatchEvent(new Event('stop')); });
  }
  fail() { this.onerror?.({ error: Error('PRIVATE_RECORDER_ERROR') }); this.dispatchEvent(new Event('error')); }
  chunk(size) { this.ondataavailable?.({ data: { size } }); }
}
class Reader {
  result = 'data:video/webm;base64,' + Buffer.from('public-frame-fixture').toString('base64');
  readAsDataURL() {
    if (settings.holdReader) { settings.releaseReader = () => this.onload?.(); return; }
    queueMicrotask(() => settings.readerError ? this.onerror?.() : settings.readerAbort ? this.onabort?.() : this.onload?.());
  }
}
const page = { evaluate: async fn => fn() };
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fisch-capture-helper-')); settings = {}; recorders = [];
  tracks = [{ stop: vi.fn() }]; capture = vi.fn(() => ({ getAudioTracks: () => settings.audio ? tracks : [], getTracks: () => tracks }));
  encoder.calls = []; encoder.error = null;
  vi.stubGlobal('window', {}); vi.stubGlobal('document', { querySelector: () => ({ captureStream: capture }) });
  vi.stubGlobal('MediaRecorder', Recorder); vi.stubGlobal('FileReader', Reader);
});
afterEach(async () => { vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
it('rejects overlapping capture before creating a second stream', async () => {
  await startBodyVideo(page);
  await expect(startBodyVideo(page)).rejects.toThrow('body_video_active');
  expect(capture).toHaveBeenCalledTimes(1); expect(recorders).toHaveLength(1);
  await finishBodyVideo(page, directory, 'fixture', 1000, null);
});
it('keeps the host event loop progressing during fake encoding and preserves the output contract', async () => {
  await startBodyVideo(page); let beats = 0;
  const timer = setInterval(() => beats++, 5);
  let result; try { result = await finishBodyVideo(page, directory, 'fixture', 1000, 3500); } finally { clearInterval(timer); }
  expect(beats).toBeGreaterThan(0);
  expect(encoder.calls).toHaveLength(1); expect(encoder.calls[0].file).toBe('ffmpeg');
  expect(result).toMatchObject({ code: 'fixture', file: 'fixture.mp4', offsetSeconds: 1.5, audioTracks: 0 });
  expect(await readFile(join(directory, 'private/fixture.webm'), 'utf8')).toBe('public-frame-fixture');
  expect(tracks[0].stop).toHaveBeenCalled(); expect(window.__bodyVideo).toBeUndefined();
});
it('cleans all tracks and capture state on constructor, start and audio errors', async () => {
  for (const flag of ['constructorError', 'startError', 'audio']) {
    settings = { [flag]: true }; tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    await expect(startBodyVideo(page)).rejects.toThrow();
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
    expect(window.__bodyVideo).toBeUndefined();
  }
});
it('rejects read errors and aborts while always releasing the recorder and stream', async () => {
  for (const flag of ['readerError', 'readerAbort']) {
    settings = { [flag]: true }; tracks = [{ stop: vi.fn() }]; await startBodyVideo(page);
    await expect(finishBodyVideo(page, directory, 'fixture', 1000, null)).rejects.toThrow('body_video_read_failed');
    expect(recorders.at(-1).state).toBe('inactive'); expect(tracks[0].stop).toHaveBeenCalled(); expect(window.__bodyVideo).toBeUndefined();
  }
});
it('stops capture at the existing size bound and rejects the oversized output', async () => {
  await startBodyVideo(page); recorders[0].chunk(64000001);
  expect(recorders[0].state).toBe('inactive'); expect(tracks[0].stop).toHaveBeenCalled();
  await expect(finishBodyVideo(page, directory, 'fixture', 1000, null)).rejects.toThrow('body_video_size_limit');
  expect(window.__bodyVideo).toBeUndefined(); expect(encoder.calls).toHaveLength(0);
});
it('releases resources on recorder errors and refuses an overlapping finish', async () => {
  await startBodyVideo(page); recorders[0].fail();
  expect(tracks[0].stop).toHaveBeenCalled();
  await expect(finishBodyVideo(page, directory, 'fixture', 1000, null)).rejects.toThrow('body_video_recording_error');
  expect(window.__bodyVideo).toBeUndefined();
  settings = { holdReader: true }; await startBodyVideo(page);
  const first = finishBodyVideo(page, directory, 'fixture', 1000, null);
  await vi.waitFor(() => expect(settings.releaseReader).toBeTypeOf('function'));
  await expect(finishBodyVideo(page, directory, 'other', 1000, null)).rejects.toThrow('body_video_finishing');
  const streams = capture.mock.calls.length; await expect(startBodyVideo(page)).rejects.toThrow('body_video_active');
  expect(capture).toHaveBeenCalledTimes(streams);
  settings.releaseReader(); await first;
});
it('propagates asynchronous encoder failure after browser resources were released', async () => {
  encoder.error = Error('fixture_encoder_failed'); await startBodyVideo(page);
  await expect(finishBodyVideo(page, directory, 'fixture', 1000, null)).rejects.toThrow('fixture_encoder_failed');
  expect(tracks[0].stop).toHaveBeenCalled(); expect(window.__bodyVideo).toBeUndefined();
});

it('cleans the stream if stopping the recorder throws', async () => {
  await startBodyVideo(page); settings.stopError = true;
  await expect(finishBodyVideo(page, directory, 'fixture', 1000, null)).rejects.toThrow('fixture_stop');
  expect(tracks[0].stop).toHaveBeenCalled(); expect(window.__bodyVideo).toBeUndefined();
});
