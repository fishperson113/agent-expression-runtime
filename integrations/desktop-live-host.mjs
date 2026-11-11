import { claimDesktopRuntime, desktopMcpConfig } from './desktop-runtime.mjs';

export function presentDesktopHost() {
  window.fischLive.externalHostPresentation();
  window.fischLive.configureReactive(false);
  window.fischLive.logActivity('Desktop MCP capability host: hội thoại thuộc Codex Desktop; không chạy Native TUI hoặc observer trong host này.');
  document.title = 'Fisch · Desktop MCP capability';
  document.getElementById('activity').textContent = 'Codex Desktop qua MCP';
  const conversation = document.querySelector('.fisch-conversation');
  conversation.setAttribute('aria-label', 'Biểu đạt từ Codex Desktop qua MCP');
  conversation.querySelector('.conversation-status').textContent = 'Nhắn trong cuộc trò chuyện Codex Desktop đã kết nối Fisch MCP; dùng Dictate nếu ứng dụng hỗ trợ. Trang này chỉ hiển thị engine; không sao chép hội thoại Desktop hoặc xác nhận nhận dạng giọng nói.';
  const form = conversation.querySelector('form');
  for (const control of form.querySelectorAll('textarea,button')) control.disabled = true;
  form.hidden = true;
}

export async function runDesktopHost({ signal, open, claim = claimDesktopRuntime, runtimeOptions, hands, assets, headless = false } = {}) {
  if (signal?.aborted) return 130;
  const runtime = claim(runtimeOptions); let live, closing, finish;
  const done = new Promise(resolve => { finish = resolve; });
  const stop = code => { if (!closing) closing = Promise.resolve().then(async () => { try { await live?.close(); } finally { runtime.close(); finish(code); } }); return closing; };
  const onAbort = () => { if (live) void stop(130); }, onClose = () => { void stop(0); }, onFail = () => { void stop(1); };
  const presentation = async () => { await live.page.waitForFunction(() => !!window.fischLive); await live.page.evaluate(presentDesktopHost); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const start = open ?? (await import('./live-launch.mjs')).openLive;
    live = await start({ signal, hands, assets, headless });
    if (signal?.aborted) { await stop(130); return await done; }
    runtime.publish({ base: live.base, token: live.token });
    live.page.once('close', onClose); live.page.once('crash', onFail); live.gateway.once('exit', onFail);
    await live.page.exposeFunction('fischLiveStop', () => { void stop(0); });
    await presentation();
    console.error('Fisch Desktop capability host ready. Camera is off. Use the configured MCP server from Codex Desktop; close this body or press Ctrl+C to stop.');
    console.error('Review this token-free Codex MCP configuration once; Fisch does not write it:\n' + desktopMcpConfig());
    return await done;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    live?.page.removeListener('close', onClose); live?.page.removeListener('crash', onFail); live?.gateway.removeListener('exit', onFail);
    await stop(1);
  }
}
