import { claimDesktopRuntime } from './desktop-runtime.mjs';

export async function runDesktopHost({ signal, open, claim = claimDesktopRuntime, runtimeOptions, hands, assets, headless = false } = {}) {
  if (signal?.aborted) return 130;
  const runtime = claim(runtimeOptions); let live, closing, finish;
  const done = new Promise(resolve => { finish = resolve; });
  const stop = code => { if (!closing) closing = Promise.resolve().then(async () => { try { await live?.close(); } finally { runtime.close(); finish(code); } }); return closing; };
  const onAbort = () => { if (live) void stop(130); }, onClose = () => { void stop(0); }, onFail = () => { void stop(1); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const start = open ?? (await import('./live-launch.mjs')).openLive;
    live = await start({ signal, hands, assets, headless });
    if (signal?.aborted) { await stop(130); return await done; }
    runtime.publish({ base: live.base, token: live.token });
    live.page.once('close', onClose); live.page.once('crash', onFail); live.gateway.once('exit', onFail);
    await live.page.exposeFunction('fischLiveStop', () => { void stop(0); });
    await live.page.evaluate(() => {
      window.fischLive.configureReactive(false);
      window.fischLive.logActivity('Desktop MCP capability host: hội thoại thuộc Codex Desktop; không chạy Native TUI hoặc observer trong host này.');
      document.title = 'Fisch · Desktop MCP capability';
      document.getElementById('activity').textContent = 'Codex Desktop qua MCP';
    });
    console.error('Fisch Desktop capability host ready. Camera is off. Use the configured MCP server from Codex Desktop; close this body or press Ctrl+C to stop.');
    return await done;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    live?.page.removeListener('close', onClose); live?.page.removeListener('crash', onFail); live?.gateway.removeListener('exit', onFail);
    await stop(1);
  }
}
