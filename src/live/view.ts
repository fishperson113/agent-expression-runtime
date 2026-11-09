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
  <label class="check"><input id="enable-reactivity" type="checkbox" disabled aria-describedby="reactivity-privacy"> Phản ứng theo camera</label><p id="reactivity-status" class="muted" role="status">Phản ứng Codex cần phiên terminal Live kết nối.</p><p id="reactivity-privacy" class="muted">Quan sát hình học dạng dữ liệu có thể gọi Codex, tối đa 4 lần/phút. Không gửi ảnh hoặc âm thanh.</p>
  <p id="summary" class="muted">Chưa có quan sát về người dùng.</p><p id="vision-metrics" class="muted">Thị giác chưa chạy</p></details>
  <section class="activity-panel" aria-labelledby="chat-heading"><div class="panel-title"><h2 id="chat-heading">Trò chuyện với Fisch</h2><span>Cùng phiên Codex</span></div>
  <p class="muted">Bạn không cần chat để Fisch phản ứng. Bật camera và phản ứng khi muốn; nhắn ở đây khi cần.</p>
  <ol id="chat-messages" aria-label="Cuộc trò chuyện với Fisch" tabindex="0"></ol>
  <p id="chat-status" class="muted" role="status">Chat cần phiên terminal Live kết nối.</p>
  <form id="chat-form"><label for="chat-input">Nhắn cho Fisch</label><textarea id="chat-input" rows="2" maxlength="16000" placeholder="Nói gì đó khi bạn muốn…" disabled></textarea>
  <div class="chat-actions"><button id="chat-send" type="submit" disabled>Gửi</button><button id="chat-stop" type="button" class="secondary" disabled>Dừng trả lời</button></div></form>
  <details><summary>Hoạt động kỹ thuật</summary><p class="muted">Trạng thái và thao tác, không phải suy nghĩ nội tâm.</p><ol id="agent-activity" aria-label="Nhật ký hoạt động agent" tabindex="0"></ol></details></section>
  </section></div>
  <details class="debug"><summary>Quan sát và chẩn đoán</summary><div class="debug-grid"><section><h2>World state v1</h2><pre id="world-state" tabindex="0">Chưa có dữ liệu</pre></section><section><h2>20 sự kiện gần nhất</h2><ol id="events"></ol></section></div><h2>Biểu đạt: nhận → áp dụng → gửi frame</h2><pre id="scene-trace" tabindex="0">Chưa có yêu cầu biểu đạt.</pre><p class="muted">Hash thay đổi không chứng minh hình có ý nghĩa. Hướng đầu không phải ánh nhìn hay nhận diện cảm xúc.</p></details>
  <footer><span>Camera tắt mặc định · không thu âm · xử lý tại máy.</span><span id="fault" role="status"></span><button id="stop-all" class="secondary">Dừng toàn bộ</button></footer></main>`;
}
export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw Error('missing_live_element_' + id);
  return result as T;
}
