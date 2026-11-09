import { afterEach, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadVideo, parseProbe, parseFrameHashes, replayVideo } from '../scripts/public-video-replay.mjs';
const fixture = fileURLToPath(new URL('./fixtures/public-video/manifest.json', import.meta.url));
const temporary = [];
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function manifestCopy(change) {
  const root = mkdtempSync(join(tmpdir(), 'public-video-')); temporary.push(root);
  const manifest = JSON.parse(readFileSync(fixture, 'utf8'));
  writeFileSync(join(root, manifest.path), readFileSync(new URL('./fixtures/public-video/hand-rubbing.webm', import.meta.url)));
  change(manifest, root); const path = join(root, 'manifest.json'); writeFileSync(path, JSON.stringify(manifest)); return path;
}
const probe = { streams: [{ codec_type: 'video', width: 640, height: 480 }], format: { duration: '2.005' } };
it('verifies the real CC0 clip against source SHA1, pinned SHA256 and exact size', () => {
  const value = loadVideo(fixture); expect(value.manifest.kind).toBe('public-video');
  expect(value.manifest.size).toBe(534113); expect(value.manifest.author).toBe('Mx. Granger');
  for (const change of [m => m.sha256 = '0'.repeat(64), m => m.sourceSha1 = '0'.repeat(40), m => m.size++,
    m => m.license = 'unknown', m => m.author = '', m => m.sourceRevision = 0])
    expect(() => loadVideo(manifestCopy(change))).toThrow();
});
it('rejects tampered video and paths outside the local asset directory', () => {
  expect(() => loadVideo(manifestCopy((m, root) => writeFileSync(join(root, m.path), 'invalid')))).toThrow();
  expect(() => loadVideo(manifestCopy(m => m.path = fileURLToPath(new URL('./fixtures/public-video/hand-rubbing.webm', import.meta.url))))).toThrow();
});
it('requires a single bounded video stream with finite duration and dimensions', () => {
  expect(parseProbe(probe)).toEqual({ width: 640, height: 480, durationSeconds: 2.005 });
  for (const invalid of [{}, { ...probe, streams: [] }, { ...probe, streams: [...probe.streams, ...probe.streams] },
    { ...probe, streams: [{ codec_type: 'video', width: 4000, height: 480 }] }, { ...probe, format: { duration: 'NaN' } },
    { ...probe, format: { duration: '60' } }]) expect(() => parseProbe(invalid)).toThrow();
});
it('parses decoded 30-fps hashes and rejects empty, corrupt or discontinuous output', () => {
  const hash = 'a'.repeat(64), text = `#tb 0: 1/30\n0, 0, 0, 1, 460800, ${hash}\n0, 1, 1, 1, 460800, ${hash}\n`;
  expect(parseFrameHashes(text).map(frame => frame.atMs)).toEqual([0, 1000 / 30]);
  for (const value of ['', text.replace('1/30', '1/25'), text.replace('0, 1, 1, 1', '0, 2, 2, 1'), text.replace(hash, 'bad')])
    expect(() => parseFrameHashes(value)).toThrow();
});
const hasFfmpeg = ['ffmpeg', 'ffprobe'].every(command => spawnSync(command, ['-version']).status === 0);
it.skipIf(!hasFfmpeg)('decodes actual public video twice, emits a playable silent replay, and refuses overwrite', () => {
  const root = mkdtempSync(join(tmpdir(), 'public-video-output-')); temporary.push(root);
  const output = join(root, 'replay.mp4'), result = replayVideo(fixture, output), again = replayVideo(fixture);
  expect(result).toMatchObject({ benchmark: false, kind: 'public-video', frameCount: 60, fps: 30, audio: false });
  expect(result.frames).toEqual(again.frames); expect(new Set(result.frames.map(frame => frame.sha256)).size).toBeGreaterThan(1);
  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8' }));
  expect(metadata.streams.map(stream => stream.codec_type)).toEqual(['video']);
  expect(metadata.streams[0]).toMatchObject({ width: 640, height: 480, avg_frame_rate: '30/1' });
  expect(() => replayVideo(fixture, output)).toThrow('exists');
}, 30000);
