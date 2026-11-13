import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

async function syntheticVideo() {
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d'); context.fillStyle = '#e02020'; context.fillRect(0, 0, 1280, 720);
  const stream = canvas.captureStream(15), video = document.createElement('video');
  const timer = setInterval(() => { context.fillStyle = '#e02020'; context.fillRect(0, 0, 1280, 720); }, 40);
  video.muted = true; document.body.append(video); video.srcObject = stream; await video.play();
  await new Promise(resolve => video.requestVideoFrameCallback(resolve));
  const result = await window.frameEncoder.encodeChatFrame(video);
  const image = new Image(); image.src = result.url; await image.decode();
  const pixels = document.createElement('canvas'); pixels.width = result.width; pixels.height = result.height;
  const ctx = pixels.getContext('2d'); ctx.drawImage(image, 0, 0);
  const pixel = [...ctx.getImageData(100, 100, 1, 1).data];
  clearInterval(timer); stream.getTracks().forEach(track => track.stop()); video.remove();
  return { width: result.width, height: result.height, bytes: atob(result.url.split(',')[1]).length, pixel };
}
it('encodes actual synthetic HTMLVideoElement pixels as a bounded JPEG without camera permission', async () => {
  const bundle = await build({ entryPoints: ['src/live/chat-camera-frame.ts'], bundle: true, write: false, format: 'iife', globalName: 'frameEncoder' });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage(); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(syntheticVideo);
    expect(result).toMatchObject({ width: 640, height: 360 }); expect(result.bytes).toBeLessThanOrEqual(192 * 1024);
    expect(result.pixel[0]).toBeGreaterThan(200); expect(result.pixel[1]).toBeLessThan(60); expect(result.pixel[2]).toBeLessThan(60);
  } finally { await browser.close(); }
}, 20000);
