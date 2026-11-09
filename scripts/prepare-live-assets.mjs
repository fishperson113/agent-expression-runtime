import { mkdir, copyFile, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const modelHash = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
export async function prepareLiveAssets(directory = resolve(root, 'public/live-assets'), { hands = process.env.FISCH_PREPARE_HANDS === '1', signal } = {}) {
  signal?.throwIfAborted();
  await mkdir(resolve(directory, 'wasm'), { recursive: true });
  const wasm = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
  for (const name of await readdir(wasm)) await copyFile(resolve(wasm, name), resolve(directory, 'wasm', name));
  const face = await prepareModel(directory, 'face_landmarker.task', modelUrl, modelHash, fetch, signal);
  if (hands) await prepareModel(directory, 'gesture_recognizer.task',
    'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
    '97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482', fetch, signal);
  return face;
}
function verified(bytes, expectedHash) {
  return bytes.length >= 100000 && bytes.length <= 20000000 && createHash('sha256').update(bytes).digest('hex') === expectedHash;
}
export async function prepareModel(directory, name, url, expectedHash, download = fetch, signal) {
  signal?.throwIfAborted();
  const model = resolve(directory, name);
  let bytes;
  try { bytes = await readFile(model); } catch { /* Missing models are downloaded below. */ }
  if (bytes && verified(bytes, expectedHash)) return { sha256: expectedHash, modelBytes: bytes.length };
  console.log('Fisch: downloading ' + name + ' from ' + new URL(url).origin + ' (up to 20 MB, SHA-256 checked). Camera and hand tracking stay off until enabled in the browser.');
  const response = await download(url, { signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]), redirect: 'error' });
  if (!response.ok) throw Error('live_model_download_' + response.status);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 20000000) throw Error('live_model_size');
    chunks.push(chunk);
  }
  bytes = Buffer.concat(chunks);
  if (!verified(bytes, expectedHash)) throw Error('live_model_hash_mismatch');
  const temporary = model + '.' + randomUUID() + '.tmp';
  try { await writeFile(temporary, bytes); await rename(temporary, model); }
  finally { await rm(temporary, { force: true }); }
  return { sha256: expectedHash, modelBytes: bytes.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  prepareLiveAssets().catch(error => { console.error(error.message); process.exitCode = 1; });
