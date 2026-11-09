import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const modelHash = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
export async function prepareLiveAssets(directory = resolve('public/live-assets')) {
  await mkdir(resolve(directory, 'wasm'), { recursive: true });
  const wasm = resolve('node_modules/@mediapipe/tasks-vision/wasm');
  for (const name of await readdir(wasm)) await copyFile(resolve(wasm, name), resolve(directory, 'wasm', name));
  const face = await prepareModel(directory, 'face_landmarker.task', modelUrl, modelHash);
  if (process.env.FISCH_PREPARE_HANDS === '1') await prepareModel(directory, 'gesture_recognizer.task',
    'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
    '97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482');
  return face;
}
async function prepareModel(directory, name, url, expectedHash) {
  const model = resolve(directory, name);
  let bytes;
  try { bytes = await readFile(model); } catch {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
    if (!response.ok) throw Error('live_model_download_' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length < 100000 || bytes.length > 20000000) throw Error('live_model_size');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedHash) throw Error('live_model_hash_mismatch');
  await writeFile(model, bytes);
  console.log(JSON.stringify({ asset: name, modelBytes: bytes.length, sha256 }));
  return { sha256, modelBytes: bytes.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  prepareLiveAssets().catch(error => { console.error(error.message); process.exitCode = 1; });
