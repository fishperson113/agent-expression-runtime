import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { digest, loadReplay, parseSegments, replayFrames } from '../scripts/ipn-hands-replay.mjs';
const fixture = fileURLToPath(new URL('./fixtures/ipn-hands/manifest.json', import.meta.url));
const temporary = [];
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function copyFixture(change = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'hands-replay-')); temporary.push(root);
  const manifest = JSON.parse(readFileSync(fixture, 'utf8'));
  for (const entry of [manifest.annotations, manifest.landmarks])
    writeFileSync(join(root, entry.path), readFileSync(new URL('./fixtures/ipn-hands/' + entry.path, import.meta.url)));
  change(manifest, root);
  const path = join(root, 'manifest.json'); writeFileSync(path, JSON.stringify(manifest)); return path;
}
function replaceLandmarks(manifest, root, change) {
  const path = join(root, manifest.landmarks.path), data = JSON.parse(readFileSync(path, 'utf8'));
  change(data); const bytes = JSON.stringify(data); writeFileSync(path, bytes); manifest.landmarks.sha256 = digest(bytes);
}
it('replays inclusive boundaries at 30 fps with no classifier or model calls', () => {
  const replay = loadReplay(fixture), frames = [...replayFrames(replay)];
  expect(frames.map(frame => frame.classId)).toEqual([0, 1, 1, 0]);
  expect(frames.map(frame => frame.frame)).toEqual([1, 2, 3, 4]);
  expect(frames[0].atMs).toBe(0); expect(frames[3].atMs).toBe(100);
  expect(JSON.stringify(frames)).not.toContain('landmarks');
  const report = JSON.parse(execFileSync(process.execPath, ['scripts/ipn-hands-replay.mjs', fixture], { encoding: 'utf8' }));
  expect(report).toMatchObject({ benchmark: false, kind: 'synthetic', frameCount: 4 });
});
it('rejects gaps, overlaps, zero indexing, malformed values and incomplete coverage', () => {
  for (const text of ['0,0,4', '0,1,2\n1,2,4', '0,1,2\n1,4,4', '15,1,4', '0,1,3', '0,1,4junk', '0,1,5', '0,1,1.5'])
    expect(() => parseSegments(text, 4)).toThrow();
});
it('fails closed on checksum mismatch or a legacy timeline', () => {
  expect(() => loadReplay(copyFixture((manifest, root) => writeFileSync(join(root, manifest.annotations.path), '0,1,4')))).toThrow('checksum');
  for (const change of [m => m.fps = 29.97, m => m.firstFrame = 0, m => m.endInclusive = false, m => m.timeline = 'original-ipn'])
    expect(() => loadReplay(copyFixture(change))).toThrow('timeline');
});
it('requires IPN attribution and the exact published archive digest', () => {
  expect(() => loadReplay(copyFixture(m => { m.kind = 'ipn-hands'; }))).toThrow('license');
  const path = copyFixture(m => Object.assign(m, { kind: 'ipn-hands', license: 'CC-BY-4.0', attribution: 'Authors',
    source: 'https://github.com/GibranBenitez/IPN-hand/blob/master/README_HandS.md', annotationArchive: { path: 'annotations.txt', sha256: '0'.repeat(64) } }));
  expect(() => loadReplay(path)).toThrow('published annotation');
  expect(spawnSync(process.execPath, ['scripts/ipn-hands-replay.mjs', path]).status).toBe(1);
});
it('rejects missing frames, surplus frames, bad hands and non-finite coordinates', () => {
  for (const change of [data => delete data['synthetic_000001.jpg'], data => data.extra = {},
    data => data['synthetic_000001.jpg'].hand_landmarks = [{ handedness: 'Left', landmarks: {} }],
    data => data['synthetic_000001.jpg'].hand_landmarks = [null, null, null],
    data => data['synthetic_000001.jpg'].hand_landmarks = [{ handedness: 'Right', landmarks: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i, [null, 0, 0]])) }]]) {
    expect(() => loadReplay(copyFixture((m, root) => replaceLandmarks(m, root, change)))).toThrow();
  }
});
it('allows off-image coordinates and empty hands as documented by IPN HandS', () => {
  const path = copyFixture((m, root) => replaceLandmarks(m, root, data => {
    const landmarks = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [index, [-0.1, 1.2, 0]]));
    data['synthetic_000002.jpg'].hand_landmarks = [{ handedness: 'Right', landmarks }];
  }));
  expect([...replayFrames(loadReplay(path))].map(frame => frame.hands)).toEqual([0, 1, 0, 0]);
});
it.skipIf(process.platform === 'win32')('does not follow an asset symlink out of the manifest directory', () => {
  const outside = mkdtempSync(join(tmpdir(), 'hands-outside-')); temporary.push(outside);
  writeFileSync(join(outside, 'annotation.txt'), '0,1,4');
  const path = copyFixture((m, root) => {
    symlinkSync(join(outside, 'annotation.txt'), join(root, 'escape.txt'));
    m.annotations = { path: 'escape.txt', sha256: digest('0,1,4') };
  });
  expect(() => loadReplay(path)).toThrow('escapes');
});
