import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const annotationSha256 = '4686a2ebf70a6036166c261bc6992d050cfba08c3b18edcdd460b3fa9f30ec71';
export function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function requireValue(condition, reason) { if (!condition) throw new Error(reason); }

function asset(root, entry) {
  requireValue(entry && typeof entry.path === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256), 'Asset requires path and SHA-256');
  const path = realpathSync(resolve(root, entry.path)), local = relative(root, path);
  requireValue(local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local), 'Asset escapes manifest directory');
  requireValue(statSync(path).size <= 32 * 1024 * 1024, 'Subset asset exceeds 32 MiB');
  const bytes = readFileSync(path);
  requireValue(digest(bytes) === entry.sha256, 'Asset checksum mismatch: ' + entry.path);
  return bytes;
}

export function parseSegments(text, frameCount) {
  let next = 1;
  const segments = text.trim().split(/\r?\n/).map(line => {
    requireValue(/^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(line), 'Expected class_id,start_frame,end_frame');
    const [classId, start, end] = line.split(',').map(Number);
    requireValue(classId >= 0 && classId <= 14 && [classId, start, end].every(Number.isSafeInteger), 'Invalid segment values');
    requireValue(start === next && end >= start && end <= frameCount, 'Segments must cover contiguous 1-based inclusive frames');
    next = end + 1;
    return { classId, start, end };
  });
  requireValue(next === frameCount + 1, 'Incomplete segment coverage');
  return segments;
}

function validateHand(hand) {
  requireValue(hand && ['Left', 'Right'].includes(hand.handedness), 'Invalid anatomical handedness');
  const points = hand.landmarks;
  requireValue(points && Object.keys(points).length === 21, 'Expected 21 hand landmarks');
  for (let index = 0; index < 21; index++) {
    const point = points[index];
    requireValue(Array.isArray(point) && point.length === 3 && point.every(Number.isFinite), 'Invalid hand coordinate');
  }
}

function validateLandmarks(landmarks, video, frameCount) {
  requireValue(landmarks && typeof landmarks === 'object' && !Array.isArray(landmarks), 'Expected landmark object');
  requireValue(Object.keys(landmarks).length === frameCount, 'Landmark frame count mismatch');
  for (let frame = 1; frame <= frameCount; frame++) {
    const record = landmarks[`${video}_${String(frame).padStart(6, '0')}.jpg`];
    requireValue(record && Array.isArray(record.hand_landmarks) && record.hand_landmarks.length <= 2, 'Missing or invalid landmark frame ' + frame);
    record.hand_landmarks.forEach(validateHand);
  }
}

export function loadReplay(manifestPath) {
  const root = realpathSync(dirname(resolve(manifestPath))), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  requireValue(manifest.version === 1 && ['synthetic', 'ipn-hands'].includes(manifest.kind), 'Unsupported manifest');
  requireValue(manifest.fps === 30 && manifest.firstFrame === 1 && manifest.endInclusive === true && manifest.timeline === 'ipn-hands-fps30', 'Unsupported timeline; never mix original IPN Hand annotations');
  requireValue(typeof manifest.video === 'string' && /^[\w#-]+$/.test(manifest.video), 'Invalid video identifier');
  requireValue(Number.isSafeInteger(manifest.frameCount) && manifest.frameCount > 0 && manifest.frameCount <= 100000, 'Invalid subset frame count');
  if (manifest.kind === 'ipn-hands') {
    requireValue(manifest.license === 'CC-BY-4.0' && typeof manifest.attribution === 'string' && manifest.attribution.trim().length > 0, 'IPN HandS requires license and attribution');
    requireValue(manifest.source === 'https://github.com/GibranBenitez/IPN-hand/blob/master/README_HandS.md', 'Expected official source');
    requireValue(manifest.annotationArchive?.sha256 === annotationSha256, 'Expected published annotation archive checksum');
    asset(root, manifest.annotationArchive);
  } else requireValue(manifest.license === 'CC0-1.0', 'Synthetic fixture requires explicit license');
  const segments = parseSegments(asset(root, manifest.annotations).toString('utf8'), manifest.frameCount);
  const landmarks = JSON.parse(asset(root, manifest.landmarks).toString('utf8'));
  validateLandmarks(landmarks, manifest.video, manifest.frameCount);
  return { manifest, segments, landmarks };
}

export function* replayFrames(replay) {
  const { manifest, segments, landmarks } = replay;
  let segment = 0;
  for (let frame = 1; frame <= manifest.frameCount; frame++) {
    while (frame > segments[segment].end) segment++;
    const key = `${manifest.video}_${String(frame).padStart(6, '0')}.jpg`;
    yield { frame, atMs: (frame - 1) * 1000 / 30, classId: segments[segment].classId, hands: landmarks[key].hand_landmarks.length };
  }
}

export function main(args) {
  requireValue(args.length === 1, 'Usage: node scripts/ipn-hands-replay.mjs <manifest.json>');
  const replay = loadReplay(args[0]), frames = [...replayFrames(replay)];
  console.log(JSON.stringify({ kind: replay.manifest.kind, benchmark: false, frameCount: frames.length,
    durationMs: frames.length * 1000 / 30, segments: replay.segments, frames }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
