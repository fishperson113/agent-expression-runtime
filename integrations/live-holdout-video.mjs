import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
const encode = promisify(execFile);

export function blindCodes(count) {
  const codes = new Set();
  while (codes.size < count) codes.add('V-' + randomBytes(4).toString('hex').toUpperCase());
  return [...codes];
}
export function writeScoringPack(directory, codes, complete = false) {
  const sorted = [...codes].sort();
  mkdirSync(resolve(directory, 'blind'), { recursive: true });
  writeFileSync(resolve(directory, 'blind', 'scoring.csv'), 'code,theme_guess,emotion_guess,clarity_0_to_10,confidence_0_to_10,notes\n' + sorted.map(code => code + ',,,,,').join('\n'));
  writeFileSync(resolve(directory, 'blind', 'index.html'), `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Fisch · chấm mù</title>
  <style>body{max-width:900px;margin:32px auto;padding:16px;background:#080e14;color:#e6f0f2;font:16px system-ui}video{width:100%;max-height:70vh}section{margin:32px 0}a{color:#79e6d3}</style>
  <h1>Fisch · chấm mù</h1><p>${complete ? 'Bộ 20 clip đã ghi đủ; chờ con người chấm.' : 'BỘ CHƯA HOÀN TẤT — chưa phát cho người chấm.'}</p><p>Không xem prompt hoặc đáp án trước khi chấm. Với mỗi clip: đoán chủ đề và cảm xúc, chấm độ dễ hiểu 0–10 và độ tự tin 0–10. Có thể ghi “không rõ”. Ghi câu trả lời độc lập trước khi thảo luận.</p>
  <p><a href="scoring.csv" download>Tải phiếu chấm</a> · Gửi lại phiếu sau khi xem hết. Chưa có kết luận đạt.</p>
  ${sorted.map(code => `<section><h2>${code}</h2><video controls preload="none" src="${code}.mp4" aria-label="Clip ${code}"></video></section>`).join('')}<p>Không có âm thanh. Đây là phần thân hạt, không phải camera người dùng.</p></html>`);
}
function startCapture() {
  if (window.__bodyVideo) throw Error('body_video_active');
  let stream, recorder, state;
  const release = () => {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
    for (const track of stream?.getTracks() ?? []) { try { track.stop(); } catch {} }
  };
  try {
    stream = document.querySelector('#body').captureStream(25);
    if (stream.getAudioTracks().length) throw Error('unexpected_audio');
    const chunks = []; let bytes = 0, overflow = false;
    recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2500000 });
    state = { recorder, stream, chunks, overflow: () => overflow, started: performance.now(), failed: false, finishing: false };
    recorder.ondataavailable = event => {
      bytes += event.data.size;
      if (bytes <= 64000000) chunks.push(event.data); else { overflow = true; release(); }
    };
    recorder.onerror = () => { state.failed = true; release(); };
    window.__bodyVideo = state; recorder.start(500);
  } catch (error) {
    release(); if (state && window.__bodyVideo === state) delete window.__bodyVideo; throw error;
  }
}
async function readCapture() {
  const state = window.__bodyVideo;
  if (!state) throw Error('body_video_missing');
  if (state.finishing) throw Error('body_video_finishing');
  state.finishing = true;
  try {
    if (state.failed) throw Error('body_video_recording_error');
    if (state.recorder.state !== 'inactive') await new Promise((resolve, reject) => {
      const stopped = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(Error('body_video_recording_error')); };
      const cleanup = () => { state.recorder.removeEventListener('stop', stopped); state.recorder.removeEventListener('error', failed); };
      state.recorder.addEventListener('stop', stopped, { once: true }); state.recorder.addEventListener('error', failed, { once: true });
      try { state.recorder.stop(); } catch (error) { cleanup(); reject(error); }
    });
    if (state.failed) throw Error('body_video_recording_error');
    if (state.overflow()) throw Error('body_video_size_limit');
    const blob = new Blob(state.chunks, { type: 'video/webm' });
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = reader.onabort = () => reject(Error('body_video_read_failed')); reader.readAsDataURL(blob);
    });
    if (typeof url !== 'string') throw Error('body_video_read_failed');
    return url.split(',')[1];
  } finally {
    try { if (state.recorder.state !== 'inactive') state.recorder.stop(); } catch {}
    for (const track of state.stream.getTracks()) { try { track.stop(); } catch {} }
    state.recorder.ondataavailable = state.recorder.onerror = null;
    if (window.__bodyVideo === state) delete window.__bodyVideo;
  }
}
export async function startBodyVideo(page) { await page.evaluate(startCapture); return Date.now(); }
export async function finishBodyVideo(page, directory, code, started, firstTool, publish = true) {
  const data = await page.evaluate(readCapture);
  const raw = resolve(directory, 'private', code + '.webm');
  await mkdir(resolve(directory, 'private'), { recursive: true });
  await mkdir(resolve(directory, 'blind'), { recursive: true });
  await writeFile(raw, Buffer.from(data, 'base64'));
  const offset = firstTool ? Math.max(0, (firstTool - started) / 1000 - 1) : 0;
  const output = resolve(directory, publish ? 'blind' : 'private', code + '.mp4');
  await encode('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-ss', String(offset), '-an',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
  return { code, file: code + '.mp4', offsetSeconds: offset, source: 'actual WebGL canvas captureStream; no still-image reconstruction', audioTracks: 0 };
}
