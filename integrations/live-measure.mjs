import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export function egressCounters(page) {
  const counts = { observations: 0, syntheticImages: 0, unexpectedFrames: 0, nonLoopbackRequests: 0, blockedExternalRequests: 0 };
  const external = new Set();
  page.on('request', request => { const url = new URL(request.url()); if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) {
    external.add(request); counts.nonLoopbackRequests++;
  } });
  page.on('requestfailed', request => {
    if (external.delete(request) && request.failure()?.errorText.includes('BLOCKED_BY_CSP')) {
      counts.nonLoopbackRequests--; counts.blockedExternalRequests++;
    }
  });
  page.on('requestfinished', request => { external.delete(request); });
  page.on('websocket', socket => { if (!socket.url().includes('/v1/live/channel')) return; socket.on('framesent', frame => {
    try {
      const value = JSON.parse(String(frame.payload));
      if (value.type === 'observation' && !value.snapshot?.pixels && !value.snapshot?.landmarks) counts.observations++;
      else if (value.type === 'look_result' && value.synthetic === true) counts.syntheticImages++;
      else if (value.type !== 'hello') counts.unexpectedFrames++;
    } catch { counts.unexpectedFrames++; }
  }); });
  return counts;
}
export async function memorySample(browser, page, collect = false) {
  const cdp = await page.context().newCDPSession(page);
  try {
    if (collect) await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('Performance.enable'); const result = await cdp.send('Performance.getMetrics');
    const values = Object.fromEntries(result.metrics.map(item => [item.name, item.value]));
    const browserCdp = await browser.newBrowserCDPSession();
    let privateBytes = null;
    try {
      if (process.platform === 'win32') {
        const info = await browserCdp.send('SystemInfo.getProcessInfo');
        const ids = info.processInfo.map(item => Number(item.id)).filter(Number.isSafeInteger);
        const command = `$liveProcesses=Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue; ($liveProcesses | Measure-Object -Property PrivateMemorySize64 -Sum).Sum`;
        const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000 });
        privateBytes = Number(stdout.trim());
      }
    } finally { await browserCdp.detach(); }
    return { heapBytes: values.JSHeapUsedSize, nodes: values.Nodes, documents: values.Documents, privateBytes, runnerRss: process.memoryUsage().rss };
  } finally { await cdp.detach(); }
}
