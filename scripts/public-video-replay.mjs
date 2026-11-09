import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
function requireValue(condition, reason) { if (!condition) throw new Error(reason); }
function hash(bytes, algorithm) { return createHash(algorithm).update(bytes).digest('hex'); }
function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
}

export function loadVideo(manifestPath) {
  const root = realpathSync(dirname(resolve(manifestPath))), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  requireValue(manifest.version === 1 && manifest.kind === 'public-video' && manifest.license === 'CC0-1.0', 'Expected CC0 public-video manifest');
  requireValue(typeof manifest.author === 'string' && manifest.author.trim().length > 0 && Number.isSafeInteger(manifest.sourceRevision) && manifest.sourceRevision > 0, 'Missing source attribution/version');
  requireValue(typeof manifest.source === 'string' && manifest.source.startsWith('https://commons.wikimedia.org/wiki/File:'), 'Expected Commons source');
  requireValue(typeof manifest.path === 'string' && manifest.path.endsWith('.webm'), 'Expected local WebM asset');
  const path = realpathSync(resolve(root, manifest.path)), local = relative(root, path), size = statSync(path).size;
  requireValue(local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local), 'Video escapes manifest directory');
  requireValue(size > 0 && size <= 8 * 1024 * 1024 && size === manifest.size, 'Video size mismatch or exceeds 8 MiB');
  const bytes = readFileSync(path);
  requireValue(bytes.subarray(0, 4).toString('hex') === '1a45dfa3', 'Expected WebM/Matroska signature');
  requireValue(hash(bytes, 'sha256') === manifest.sha256 && hash(bytes, 'sha1') === manifest.sourceSha1, 'Video checksum mismatch');
  return { manifest, path };
}

export function parseProbe(value) {
  const videos = value.streams?.filter(stream => stream.codec_type === 'video') ?? [];
  requireValue(videos.length === 1, 'Expected one video stream');
  const { width, height } = videos[0], durationSeconds = Number(value.format?.duration);
  requireValue(Number.isInteger(width) && width > 0 && width <= 1920 && Number.isInteger(height) && height > 0 && height <= 1080, 'Video dimensions exceed bounds');
  requireValue(Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= 30, 'Video duration exceeds bounds');
  return { width, height, durationSeconds };
}

export function parseFrameHashes(text) {
  requireValue(text.includes('#tb 0: 1/30'), 'Expected 30-fps decoded timeline');
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  requireValue(lines.length > 0 && lines.length <= 900, 'Invalid decoded frame count');
  return lines.map((line, index) => {
    const parts = line.split(',').map(part => part.trim());
    requireValue(parts.length === 6 && parts[0] === '0' && Number(parts[1]) === index && Number(parts[2]) === index && parts[3] === '1' && /^[a-f0-9]{64}$/.test(parts[5]), 'Invalid or discontinuous decoded frame hash');
    return { frame: index + 1, atMs: index * 1000 / 30, sha256: parts[5] };
  });
}

export function replayVideo(manifestPath, outputPath) {
  const { manifest, path } = loadVideo(manifestPath);
  if (outputPath) requireValue(outputPath.endsWith('.mp4') && !existsSync(resolve(outputPath)), 'Replay output must be a new .mp4 path; output exists or has wrong extension');
  const input = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'matroska', '-threads', '1', '-i', path];
  const metadata = parseProbe(JSON.parse(run('ffprobe', [...input, '-show_streams', '-show_format', '-of', 'json'])));
  const decode = ['-nostdin', ...input, '-map', '0:v:0', '-an', '-sn', '-dn', '-t', '30', '-vf', 'fps=30,format=yuv420p', '-threads', '1'];
  const frames = parseFrameHashes(run('ffmpeg', [...decode, '-f', 'framehash', '-hash', 'sha256', 'pipe:1']));
  if (outputPath) run('ffmpeg', [...decode, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-movflags', '+faststart', '-n', resolve(outputPath)]);
  return { kind: manifest.kind, benchmark: false, source: manifest.source, license: manifest.license, author: manifest.author,
    sourceSha1: manifest.sourceSha1, sha256: manifest.sha256, ...metadata, fps: 30, frameCount: frames.length, audio: false,
    output: outputPath ? resolve(outputPath) : null, frames };
}

export function main(args) {
  requireValue(args.length >= 1 && args.length <= 2, 'Usage: node scripts/public-video-replay.mjs <manifest.json> [new-replay.mp4]');
  console.log(JSON.stringify(replayVideo(...args), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
