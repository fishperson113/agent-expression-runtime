type Native = 'waiting' | 'connected';
const observerMessages = {
  disabled_by_config: 'Observer đang tắt trong cấu hình.',
  missing_model_or_endpoint: 'Observer chưa đủ cấu hình bộ quyết định.',
  missing_api_key: 'Observer chưa có thông tin xác thực cần thiết.',
  invalid_provider_config: 'Cấu hình bộ quyết định chưa hợp lệ.',
  missing_budget: 'Observer chưa có ngân sách đã được cho phép.',
  invalid_budget_path: 'Chưa truy cập được cấu hình ngân sách.',
  budget_unavailable: 'Ngân sách hiện chưa khả dụng.',
  budget_expired: 'Ngân sách đã hết thời hạn.',
  budget_exhausted: 'Ngân sách đã dùng hết.',
  ready: 'Observer đã cấu hình; chưa có nghĩa camera hoặc phản ứng đang bật.',
  unavailable: 'Chưa xác nhận cấu hình observer.'
} as const;
type Observer = keyof typeof observerMessages;
const css = `.fisch-live-setup{min-width:0}.fisch-live-setup p,.fisch-live-setup li{font-size:13px;line-height:1.6;overflow-wrap:anywhere;margin:10px 0}.fisch-live-setup ol{padding-left:20px}`;

function projection(value: unknown): { native?: Native; observer: Observer } {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { observer: 'unavailable' };
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 2 || !keys.includes('native') || !keys.includes('observer')) return { observer: 'unavailable' };
    if (!('value' in descriptors.native) || !('value' in descriptors.observer)) return { observer: 'unavailable' };
    const native = descriptors.native.value, observer = descriptors.observer.value;
    if ((native !== 'waiting' && native !== 'connected') || typeof observer !== 'string' ||
      !Object.hasOwn(observerMessages, observer)) return { observer: 'unavailable' };
    return { native, observer: observer as Observer };
  } catch { return { observer: 'unavailable' }; }
}

function elements() {
  const host = document.createElement('section'); host.className = 'fisch-live-setup'; host.setAttribute('aria-label', 'Kết nối agent và hướng dẫn');
  host.innerHTML = `<details><summary>Kết nối</summary><div role="status" aria-live="polite" aria-atomic="true"><p class="setup-native"></p><p class="setup-observer"></p></div>

    <p>Kết nối gateway chỉ nối trang với Fisch; không xác nhận Native Codex đã chọn phiên hoặc observer đã sẵn sàng.</p>
    <ol><li>Trò chuyện trong terminal Native Codex đang chạy cùng Fisch. Chờ Codex chọn phiên trước khi gửi yêu cầu.</li>
    <li>Trong Cùng sáng tạo, chép yêu cầu rồi tự dán vào terminal đó; trang không tự gửi.</li>
    <li>Camera chỉ bật khi bạn chủ động chọn và xử lý tại máy; bật camera không tự bật observer. Observer cần bộ quyết định riêng, ngân sách đã được cho phép và bạn chọn ô phản ứng tự động. Xem trạng thái phản ứng hiện tại trong Thiết lập ở Góc của bạn.</li></ol>
    <p><a href="https://github.com/fishperson113/agent-expression-runtime/blob/main/docs/reactive-provider.md" target="_blank" rel="noopener noreferrer">Hướng dẫn cấu hình observer</a></p>
    <p><a href="https://github.com/fishperson113/agent-expression-runtime/blob/main/docs/live-windows-qa.md" target="_blank" rel="noopener noreferrer">Chạy và cập nhật CLI trên Windows</a></p>
    <p>Dừng hoặc khởi chạy lại từ terminal. Tạo hình riêng trong phiên không tự được khôi phục sau khi khởi chạy lại.</p></details>`;
  const style = document.createElement('style'); style.textContent = css; host.prepend(style);
  return { host, native: host.querySelector<HTMLElement>('.setup-native')!, observer: host.querySelector<HTMLElement>('.setup-observer')! };
}

export function mountLiveSetup(container: HTMLElement) {
  const ui = elements(); container.append(ui.host); let disposed = false;
  const project = (value: unknown) => {
    if (disposed) return;
    const dto = projection(value);
    const native = dto.native === 'connected'
      ? 'Native Codex đã chọn phiên; nhập tại terminal hiện tại, chưa xác nhận lượt trả lời của agent.'
      : dto.native === 'waiting' ? 'Native Codex đang chờ chọn phiên trong terminal.' : 'Chưa xác nhận phiên Native Codex.';
    const observer = observerMessages[dto.observer];
    if (ui.native.textContent !== native) ui.native.textContent = native;
    if (ui.observer.textContent !== observer) ui.observer.textContent = observer;
  };
  project(undefined);
  return { project, dispose: () => { if (!disposed) { disposed = true; ui.host.remove(); } } };
}
