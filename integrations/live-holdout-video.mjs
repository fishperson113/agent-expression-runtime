import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function blindCodes(count) {
  const codes = new Set();
  while (codes.size < count) codes.add('V-' + randomBytes(4).toString('hex').toUpperCase());
  return [...codes];
}
export function writeScoringPack(directory, codes) {
  const sorted = [...codes].sort();
  mkdirSync(resolve(directory, 'blind'), { recursive: true });
  writeFileSync(resolve(directory, 'blind', 'scoring.csv'), 'code,theme_guess,emotion_guess,clarity_0_to_10,confidence_0_to_10,notes\n' + sorted.map(code => code + ',,,,,').join('\n'));
  writeFileSync(resolve(directory, 'blind', 'index.html'), `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Fisch · chấm mù</title>
  <style>body{max-width:900px;margin:32px auto;padding:16px;background:#080e14;color:#e6f0f2;font:16px system-ui}video{width:100%;max-height:70vh}section{margin:32px 0}a{color:#79e6d3}</style>
  <h1>Fisch · chấm mù</h1><p>Không xem prompt hoặc đáp án trước khi chấm. Với mỗi clip: đoán chủ đề và cảm xúc, chấm độ dễ hiểu 0–10 và độ tự tin 0–10. Có thể ghi “không rõ”. Ghi câu trả lời độc lập trước khi thảo luận.</p>
  <p><a href="scoring.csv" download>Tải phiếu chấm</a> · Gửi lại phiếu sau khi xem hết. Chưa có kết luận đạt.</p>
  ${sorted.map(code => `<section><h2>${code}</h2><video controls preload="none" src="${code}.mp4" aria-label="Clip ${code}"></video></section>`).join('')}<p>Không có âm thanh. Đây là phần thân hạt, không phải camera người dùng.</p></html>`);
}
export async function startBodyVideo(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('#body');
    const stream = canvas.captureStream(25), chunks = [];
    if (stream.getAudioTracks().length) throw Error('unexpected_audio');
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2500000 });
    let bytes = 0, overflow = false;
    recorder.ondataavailable = event => {
      bytes += event.data.size;
      if (bytes <= 64000000) chunks.push(event.data); else overflow = true;
    };
    window.__bodyVideo = { recorder, stream, chunks, overflow: () => overflow, started: performance.now() };
    recorder.start(500);
  });
  return Date.now();
}
export async function finishBodyVideo(page, directory, code, started, firstTool, publish = true) {
  const data = await page.evaluate(async () => {
    const state = window.__bodyVideo;
    await new Promise(resolve => { state.recorder.onstop = resolve; state.recorder.stop(); });
    state.stream.getTracks().forEach(track => track.stop());
    if (state.overflow()) throw Error('body_video_size_limit');
    const blob = new Blob(state.chunks, { type: 'video/webm' });
    const url = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
    delete window.__bodyVideo;
    return url.split(',')[1];
  });
  const raw = resolve(directory, 'private', code + '.webm');
  mkdirSync(resolve(directory, 'private'), { recursive: true });
  mkdirSync(resolve(directory, 'blind'), { recursive: true });
  writeFileSync(raw, Buffer.from(data, 'base64'));
  const offset = firstTool ? Math.max(0, (firstTool - started) / 1000 - 1) : 0;
  const output = resolve(directory, publish ? 'blind' : 'private', code + '.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-ss', String(offset), '-an',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
  return { code, file: code + '.mp4', offsetSeconds: offset, source: 'actual WebGL canvas captureStream; no still-image reconstruction', audioTracks: 0 };
}
