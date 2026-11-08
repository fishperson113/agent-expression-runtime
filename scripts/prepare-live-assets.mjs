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
  const model = resolve(directory, 'face_landmarker.task');
  let bytes;
  try { bytes = await readFile(model); } catch {
    const response = await fetch(modelUrl, { signal: AbortSignal.timeout(60000), redirect: 'error' });
    if (!response.ok) throw Error('live_model_download_' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100000 || bytes.length > 20000000) throw Error('live_model_size');
    await writeFile(model, bytes);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== modelHash) throw Error('live_model_hash_mismatch');
  console.log(JSON.stringify({ assets: directory, modelBytes: bytes.length, sha256 }));
  return { sha256, modelBytes: bytes.length };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  prepareLiveAssets().catch(error => { console.error(error.message); process.exitCode = 1; });
