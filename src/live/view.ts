export function mountLive(root: HTMLElement) {
  root.innerHTML = `<a class="skip" href="#workspace">Đến vùng làm việc</a>
  <header><a href="/live.html" class="brand">fisch<span> / live</span></a><span class="local-label">CÙNG BẠN TẠI MÁY</span><span id="connection" role="status">Chưa nối Codex</span></header>
  <main id="workspace">
  <div class="live-grid">
  <section class="body-panel" aria-labelledby="body-heading"><div class="panel-title"><h2 id="body-heading">Fisch</h2><span id="activity">Đang chờ tương tác</span></div>
  <div class="body-stage"><canvas id="body" aria-label="Mặt cá bằng hạt của Fisch"></canvas><span class="stage-label">FISCH · PARTICLE PRESENCE</span><span id="look-indicator" role="status" hidden></span></div>
  <div class="body-actions"><label for="motion">Chuyển động</label><select id="motion"><option value="normal">Bình thường</option><option value="reduced">Giảm chuyển động</option><option value="off">Tắt chuyển động</option></select><button id="fullscreen" class="secondary">Toàn màn hình</button><button id="cancel" class="secondary">Dừng biểu đạt</button></div>
  <p id="body-status" class="muted">Phản xạ local sẵn sàng; chờ Codex chọn cách biểu đạt.</p><p id="render-metrics" class="muted">Đang khởi tạo renderer.</p></section>
  <section class="camera-panel" aria-labelledby="camera-heading"><div class="panel-title"><h2 id="camera-heading">Bạn</h2><span id="camera-status" role="status">Camera đang tắt</span></div>
  <div class="camera-stage"><video id="camera" autoplay muted playsinline aria-label="Video camera local của bạn"></video><canvas id="landmarks" aria-hidden="true"></canvas><p id="camera-placeholder">Bạn chủ động bật camera.<br>Không ghi hình. Không thu âm.</p><span class="stage-label">BẠN · CAMERA LOCAL</span></div>
  <div class="camera-actions"><button id="camera-start">Bật camera</button><button id="camera-stop" class="secondary" disabled>Tắt camera</button><label class="check"><input id="show-landmarks" type="checkbox" checked> Điểm theo dõi</label></div>
  <details class="camera-options"><summary>Quan sát và phản ứng</summary><label class="check"><input id="enable-hands" type="checkbox"> Cử chỉ tay cho Codex · thử nghiệm</label><p id="hand-status" class="muted" role="status">Cử chỉ tay đang tắt</p>
  <label class="check"><input id="enable-reactivity" type="checkbox" disabled aria-describedby="reactivity-privacy"> Phản ứng theo camera</label><p id="reactivity-status" class="muted" role="status">Phản ứng tự động chưa có bộ quyết định được kết nối.</p><p id="reactivity-privacy" class="muted">Khi bật, quan sát hình học dạng dữ liệu được gửi tới bộ quyết định đã cấu hình, tối đa 4 lần/phút. Không gửi ảnh, âm thanh hoặc nội dung chat/code.</p>
  <p id="summary" class="muted">Chưa có quan sát về người dùng.</p><p id="vision-metrics" class="muted">Thị giác chưa chạy</p></details>
  <section class="activity-panel" aria-labelledby="agent-activity-heading"><div class="panel-title"><h2 id="agent-activity-heading">Hoạt động agent</h2><span>Sự kiện thực tế</span></div><p class="muted">Trạng thái và thao tác, không phải suy nghĩ nội tâm.</p><ol id="agent-activity" aria-label="Nhật ký hoạt động agent" tabindex="0"></ol></section>
  </section></div>
  <details class="debug"><summary>Quan sát và chẩn đoán</summary><div class="debug-grid"><section><h2>World state v1</h2><pre id="world-state" tabindex="0">Chưa có dữ liệu</pre></section><section><h2>20 sự kiện gần nhất</h2><ol id="events"></ol></section></div><h2>Biểu đạt: nhận → áp dụng → gửi frame</h2><pre id="scene-trace" tabindex="0">Chưa có yêu cầu biểu đạt.</pre><p class="muted">Hash thay đổi không chứng minh hình có ý nghĩa. Hướng đầu không phải ánh nhìn hay nhận diện cảm xúc.</p>
  <section aria-labelledby="trace-heading"><h2 id="trace-heading">Bản ghi chẩn đoán tại máy</h2><p id="trace-privacy" class="muted">Chỉ ghi khi bạn bật. Bản ghi chứa tọa độ theo dõi và ID, không chứa ảnh, âm thanh, chat hoặc prompt; không tự gửi đi. Tự xóa sau 60 giây, dừng sớm khi đầy. Lượt ghi mới thay bản cũ. Xuất JSON sẽ lưu bản bạn tự quản lý.</p>
  <div class="body-actions" aria-describedby="trace-privacy"><button id="trace-start" class="secondary">Ghi 60 giây</button><button id="trace-stop" class="secondary" disabled>Dừng ghi</button><button id="trace-export" class="secondary" disabled>Xuất JSON</button><button id="trace-clear" class="secondary" disabled>Xóa bản ghi</button></div><p id="trace-status" class="muted" role="status">Chưa ghi.</p></section></details>
  <footer><span>Camera tắt mặc định · không thu âm · xử lý tại máy.</span><span id="fault" role="status"></span><button id="stop-all" class="secondary">Dừng toàn bộ</button></footer></main>`;
}
export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw Error('missing_live_element_' + id);
  return result as T;
}
