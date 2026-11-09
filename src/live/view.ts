export function mountLive(root: HTMLElement) {
  root.innerHTML = `<a class="skip" href="#workspace">Đến vùng làm việc</a>
  <header><a href="/live.html" class="brand">fisch<span> / live</span></a><span class="local-label">CHẠY TẠI MÁY</span><span id="connection" role="status">Chưa nối Codex</span></header>
  <main id="workspace">
  <div class="live-grid"><details class="camera-panel" open><summary>Camera · tùy chọn</summary><section aria-labelledby="camera-heading"><div class="panel-title"><h2 id="camera-heading">Quan sát tại máy</h2><span id="camera-status" role="status">Camera đang tắt</span></div>
  <div class="camera-stage"><video id="camera" autoplay muted playsinline aria-label="Video camera local của bạn"></video><canvas id="landmarks" aria-hidden="true"></canvas><p id="camera-placeholder">Bạn chủ động bật camera.<br>Không ghi hình. Không thu âm.</p></div>
  <div class="camera-actions"><button id="camera-start">Bật camera</button><button id="camera-stop" class="secondary" disabled>Tắt camera</button><label class="check"><input id="show-landmarks" type="checkbox" checked> Điểm theo dõi</label></div>
  <label class="check"><input id="enable-hands" type="checkbox"> Cử chỉ tay · thử nghiệm</label><p id="hand-status" class="muted" role="status">Cử chỉ tay đang tắt</p>
  <p id="summary" class="muted">Chưa có quan sát về người dùng.</p><p id="vision-metrics" class="muted">Thị giác chưa chạy</p></section></details>
  <section class="body-panel" aria-labelledby="body-heading"><div class="panel-title"><h2 id="body-heading">Fisch</h2><span id="activity">Đang chờ tương tác</span></div><div class="body-stage"><canvas id="body" aria-label="Cơ thể hạt WebGL của Fisch"></canvas><span id="look-indicator" role="status" hidden></span></div>
  <div class="body-actions"><label for="motion">Chuyển động</label><select id="motion"><option value="normal">Bình thường</option><option value="reduced">Giảm chuyển động</option><option value="off">Tắt chuyển động</option></select><button id="fullscreen" class="secondary">Toàn màn hình</button><button id="cancel" class="secondary">Dừng biểu đạt</button></div><p id="body-status" class="muted">Phản xạ local sẵn sàng; chờ Codex chọn cách biểu đạt.</p><p id="render-metrics" class="muted">Đang khởi tạo renderer…</p></section></div>
  <details class="debug"><summary>Quan sát và chẩn đoán</summary><div class="debug-grid"><section><h2>World state v1</h2><pre id="world-state" tabindex="0">Chưa có dữ liệu</pre></section><section><h2>20 sự kiện gần nhất</h2><ol id="events"></ol></section></div><h2>Biểu đạt: nhận → áp dụng → gửi frame</h2><pre id="scene-trace" tabindex="0">Chưa có yêu cầu biểu đạt.</pre><p class="muted">Hash thay đổi không chứng minh hình có ý nghĩa. Hướng đầu không phải ánh nhìn hay nhận diện cảm xúc.</p></details>
  <footer><span>Camera tắt mặc định · không thu âm · xử lý tại máy.</span><span id="fault" role="status"></span><button id="stop-all" class="secondary">Dừng toàn bộ</button></footer></main>`;
}
export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw Error('missing_live_element_' + id);
  return result as T;
}
