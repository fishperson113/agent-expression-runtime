export function mountLive(root: HTMLElement) {
  root.innerHTML = `<a class="skip" href="#workspace">Đến vùng làm việc</a>
  <header><a href="/live.html" class="brand">fisch<span class="brand-dot">·</span></a><span class="local-label">MỘT CHÚT HIỆN DIỆN, CÙNG BẠN.</span><span id="connection" role="status">Chưa nối Codex</span></header>
  <main id="workspace" tabindex="-1">
  <div class="live-grid">
  <section class="body-panel" aria-labelledby="body-heading"><div class="panel-title"><h2 id="body-heading">Ở đây, cùng bạn.</h2><span id="activity">Đang chờ tương tác</span></div>
  <div class="body-stage"><canvas id="body" aria-label="Mặt cá bằng hạt của Fisch"></canvas><span class="stage-label">FISCH / PARTICLE PRESENCE</span><span id="look-indicator" role="status" hidden></span></div>
  <div class="body-toolbar"><div id="playground-tools"></div><div class="body-actions"><label for="motion" class="sr-only">Chuyển động</label><select id="motion" aria-label="Chuyển động"><option value="normal">Tự nhiên</option><option value="reduced">Giảm chuyển động</option><option value="off">Tắt chuyển động</option></select><button id="fullscreen" class="secondary">Toàn màn hình</button><button id="cancel" class="secondary" aria-label="Dừng biểu đạt"><span class="wide-copy">Dừng biểu đạt</span><span class="compact-copy" aria-hidden="true">Dừng</span></button></div></div></section>
  <section class="camera-panel" aria-labelledby="camera-heading"><div class="camera-card"><div class="panel-title"><h2 id="camera-heading">Góc của bạn</h2><span id="camera-status" role="status">Camera đang tắt</span></div>
  <div class="camera-stage"><video id="camera" autoplay muted playsinline aria-label="Video camera local của bạn"></video><canvas id="landmarks" aria-hidden="true"></canvas><div id="camera-placeholder"><span class="camera-glyph" aria-hidden="true">◎</span><p>Hiện diện theo cách của bạn.</p><span>Bật camera: mỗi tin nhắn trong panel sẽ gửi kèm một ảnh camera gần nhất tới Codex. Observer tự động vẫn chỉ nhận hình học.</span></div><span class="stage-label">CAMERA / ẢNH KÈM TIN NHẮN</span></div>
  <div class="camera-actions"><button id="camera-start">Bật camera</button><button id="camera-stop" class="secondary" disabled>Tắt camera</button>
  <details class="camera-options"><summary>Thiết lập</summary><label class="check"><input id="show-landmarks" type="checkbox" checked> Điểm theo dõi</label><label class="check"><input id="enable-hands" type="checkbox"> Theo dõi tay tại máy · thử nghiệm</label><p id="hand-status" class="muted" role="status">Cử chỉ tay đang tắt</p>
  <label class="check"><input id="enable-reactivity" type="checkbox" disabled aria-describedby="reactivity-privacy"> Phản ứng theo camera</label><p id="reactivity-status" class="muted" role="status">Đang chờ cấu hình Codex chủ động.</p><p id="reactivity-privacy" class="muted">Với Codex, phản ứng chủ động sẵn sàng mặc định sau khi cấu hình. Camera chỉ bật khi bạn chọn và cấp quyền. Quan sát hình học dạng dữ liệu được gửi tới bộ quyết định, tối đa 4 lần/phút và có thể dùng hạn mức tài khoản Codex. Observer này không gửi ảnh, âm thanh hoặc nội dung chat/code. Bạn có thể tắt phản ứng ở đây.</p>
  <p id="summary" class="muted">Chưa có quan sát về người dùng.</p><p id="vision-metrics" class="muted">Thị giác chưa chạy</p></details></div></div>
  <section class="activity-panel conversation-panel" aria-label="Trò chuyện trong phiên Codex"><div class="conversation-tools"><div id="setup-tools"></div><details class="technical-log"><summary>Hoạt động kỹ thuật</summary><p>Trạng thái và thao tác, không phải nội dung hội thoại.</p><ol id="agent-activity" aria-label="Nhật ký hoạt động agent, không phải suy nghĩ nội tâm" tabindex="0"></ol></details></div><div id="conversation-tools"></div></section>
  </section></div>
  <footer><span class="privacy-note">Camera tắt mặc định <span aria-hidden="true">·</span> Không thu âm</span><span id="fault" role="status"></span>
  <details class="debug"><summary>Chẩn đoán</summary><p id="body-status" class="muted">Phản xạ local sẵn sàng; chờ Codex chọn cách biểu đạt.</p><p id="render-metrics" class="muted">Đang khởi tạo renderer.</p>
  <section aria-labelledby="trace-heading"><h2 id="trace-heading">Bản ghi chẩn đoán tại máy</h2><p id="trace-privacy" class="muted">Chỉ ghi khi bạn bật. Bản ghi chứa tọa độ theo dõi và ID, không chứa ảnh, âm thanh, chat hoặc prompt; không tự gửi đi. Tự xóa sau 60 giây, dừng sớm khi đầy. Lượt ghi mới thay bản cũ. Xuất JSON sẽ lưu bản bạn tự quản lý.</p>
  <div class="body-actions" aria-describedby="trace-privacy"><button id="trace-start" class="secondary">Ghi 60 giây</button><button id="trace-stop" class="secondary" disabled>Dừng ghi</button><button id="trace-export" class="secondary" disabled>Xuất JSON</button><button id="trace-clear" class="secondary" disabled>Xóa bản ghi</button></div><p id="trace-status" class="muted" role="status">Chưa ghi.</p></section>
  <div class="debug-grid"><section><h2>World state v1</h2><pre id="world-state" tabindex="0">Chưa có dữ liệu</pre></section><section><h2>20 sự kiện gần nhất</h2><ol id="events" tabindex="0"></ol></section></div><h2>Biểu đạt: nhận → áp dụng → gửi frame</h2><pre id="scene-trace" tabindex="0">Chưa có yêu cầu biểu đạt.</pre><p class="muted">Hash thay đổi không chứng minh hình có ý nghĩa. Hướng đầu không phải ánh nhìn hay nhận diện cảm xúc.</p></details>
  <button id="stop-all" class="secondary">Dừng toàn bộ</button></footer></main>`;
}
export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw Error('missing_live_element_' + id);
  return result as T;
}

/** Keep secondary tools out of the canvas without changing their local state. */
export function mountDisclosures(root: HTMLElement) {
  const stop = root.querySelector<HTMLButtonElement>('#stop-all')!;
  const home = stop.parentElement!;
  root.querySelectorAll<HTMLDetailsElement>('.camera-options, .debug, .technical-log, .fisch-playground details, .fisch-live-setup details').forEach(details => {
    const summary = details.querySelector('summary')!;
    const dialog = document.createElement('dialog'); dialog.className = 'tool-dialog';
    const header = document.createElement('div'); header.className = 'dialog-heading';
    const title = document.createElement('h2'); title.textContent = summary.textContent;
    title.id = `tool-title-${root.querySelectorAll('dialog').length}`;
    dialog.setAttribute('aria-labelledby', title.id);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'secondary';
    close.textContent = 'Đóng'; close.setAttribute('aria-label', `Đóng ${summary.textContent}`);
    header.append(title, close); dialog.append(header);
    const content = document.createElement('div'); content.className = 'dialog-content';
    while (summary.nextSibling) content.append(summary.nextSibling);
    dialog.append(content); details.append(dialog);
    summary.setAttribute('aria-haspopup', 'dialog');
    const restore = () => {
      if (header.contains(stop)) (document.fullscreenElement?.querySelector('.body-actions') ?? home).append(stop);
    };
    const shut = () => {
      const active = details.open || dialog.open; details.open = false;
      if (active) details.dispatchEvent(new Event('fisch:tool-dismiss'));
      if (dialog.open) dialog.close(); restore(); summary.focus({ preventScroll: true });
    };
    const show = () => { header.append(stop); dialog.showModal(); close.focus({ preventScroll: true }); };
    close.onclick = shut;
    dialog.addEventListener('cancel', event => { event.preventDefault(); shut(); });
    summary.onclick = event => { event.preventDefault(); details.open = true; show(); };
    stop.addEventListener('click', () => { if (dialog.open) shut(); }, { capture: true });
    details.addEventListener('toggle', event => {
      if (event.target !== details) return;
      if (details.open && !dialog.open) show();
      else if (!details.open && dialog.open) shut();
    });
    dialog.addEventListener('close', () => { if (!dialog.open && details.open) shut(); });
    dialog.addEventListener('click', event => {
      const box = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) shut();
    });
  });
}
