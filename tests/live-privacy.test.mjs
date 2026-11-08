import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

it('applies loopback-only CSP to documents and workers and blocks off-machine fetch', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser;
  try {
    browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage(); const response = await page.goto(server.resolvedUrls.local[0] + 'live.html');
    expect(response.headers()['content-security-policy']).toContain("connect-src 'self' http://127.0.0.1:*");
    const worker = await page.request.get(server.resolvedUrls.local[0] + 'src/live/vision.worker.ts');
    expect(worker.headers()['content-security-policy']).toContain("connect-src 'self'");
    expect(await page.evaluate(async () => {
      try { await fetch('https://example.invalid/fisch-egress-probe'); return 'escaped'; } catch { return 'blocked'; }
    })).toBe('blocked');
    const result = await page.evaluate(() => new Promise(resolve => {
      const source = "fetch('https://example.invalid/fisch-worker-probe').then(()=>postMessage('escaped')).catch(()=>postMessage('blocked'))";
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url); worker.onmessage = event => { worker.terminate(); URL.revokeObjectURL(url); resolve(event.data); };
    }));
    expect(result).toBe('blocked');
  } finally { await browser?.close(); await server.close(); }
}, 60000);
