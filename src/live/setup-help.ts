type Native = 'waiting' | 'connected';
const observerMessages = {
  disabled_by_config: 'Observer ngữ nghĩa đang tắt trong cấu hình. Phản xạ cục bộ vẫn dùng tín hiệu hợp lệ, không cần API riêng.',
  missing_model_or_endpoint: 'Observer chưa đủ cấu hình bộ quyết định.',
  missing_api_key: 'Observer chưa có thông tin xác thực cần thiết.',
  invalid_provider_config: 'Cấu hình bộ quyết định chưa hợp lệ.',
  missing_budget: 'Observer chưa có ngân sách đã được cho phép.',
  invalid_budget_path: 'Chưa truy cập được cấu hình ngân sách.',
  budget_unavailable: 'Ngân sách hiện chưa khả dụng.',
  budget_expired: 'Ngân sách đã hết thời hạn.',
  budget_exhausted: 'Ngân sách đã dùng hết.',
  ready: 'Observer đã cấu hình; Codex chủ động mặc định. Camera chỉ bật khi bạn chọn và cấp quyền. Trạng thái cấu hình không xác nhận lượt phản hồi.',
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
  host.innerHTML = `<details><summary>Kết nối · <span class="setup-state" role="status" aria-live="polite"></span></summary><div><p class="setup-observer"></p><p class="setup-native"></p></div>

    <div class="setup-local-guide"><p>Kết nối gateway chỉ nối trang với Fisch; không xác nhận Native Codex đã chọn phiên hoặc observer đã sẵn sàng.</p>
    <ol><li>Chạy fisch live, dùng Codex đã đăng nhập trong terminal đang mở cùng Fisch. Nếu chưa đăng nhập, hoàn tất hướng dẫn của Codex tại đó; trạng thái cấu hình chưa chứng minh xác thực thành công.</li>
    <li>Chờ Codex chọn phiên rồi trò chuyện ở khung chat hoặc terminal. Trong Cùng sáng tạo, yêu cầu mẫu chỉ được chép để bạn tự gửi, không tự gửi.</li>
    <li>Bật camera và cấp quyền khi bạn muốn quan sát. Codex chủ động được chuẩn bị mặc định, không cần tự đặt biến môi trường hay tạo ledger; lịch sử sử dụng được giữ tại máy. Bạn có thể tắt phản ứng trong Thiết lập ở Góc của bạn. Phản xạ vị trí chạy cục bộ; observer chỉ nhận dữ liệu hình học, không nhận ảnh hay suy ra cảm xúc/đồ vật. Camera tắt vẫn có chat; nhập giọng nói bằng dictation của Codex chưa được kiểm chứng trong phiên Fisch.</li></ol>
    <p><a href="https://github.com/fishperson113/agent-expression-runtime/blob/main/docs/reactive-provider.md" target="_blank" rel="noopener noreferrer">Hướng dẫn cấu hình observer</a></p>
    <p><a href="https://github.com/fishperson113/agent-expression-runtime/blob/main/docs/live-windows-qa.md" target="_blank" rel="noopener noreferrer">Chạy và cập nhật CLI trên Windows</a></p>
    <p>Dừng hoặc khởi chạy lại từ terminal. Tạo hình riêng trong phiên không tự được khôi phục sau khi khởi chạy lại.</p></div>
    <div class="setup-external-guide" hidden><p>Gửi tin nhắn trong cuộc trò chuyện Codex Desktop đã kết nối Fisch MCP. Trang này chỉ hiển thị engine; không nhận hay sao chép hội thoại của ứng dụng.</p>
    <p>Dùng Dictate trong Codex Desktop nếu phiên bản của bạn hỗ trợ, rồi kiểm tra và gửi văn bản tại đó. Fisch không cung cấp STT/TTS và không xác nhận microphone hoặc dictation đang hoạt động.</p>
    <p>Camera mặc định tắt; chỉ bật và cấp quyền khi muốn quan sát. Observer Codex được chuẩn bị mặc định, chỉ nhận hình học được hỗ trợ; không nhận ảnh camera hoặc tự suy ra cảm xúc/đồ vật. Có thể tắt phản ứng trong Thiết lập.</p>
    <p>Caption chủ động nằm riêng trên trang Fisch, không gửi lại thành tin nhắn Native. Hội thoại/Dictate do Native sở hữu; host chỉ biết ý định mới khi có MCP operation, không theo dõi lúc bắt đầu nói hay gửi text trước tool call.</p>
    <p>Dừng toàn bộ, đóng hoặc tải lại trang sẽ dừng host. Chạy lại fisch desktop và kết nối lại MCP để bắt đầu một body mới; không tự khôi phục hình cũ.</p></div></details>`;
  const style = document.createElement('style'); style.textContent = css; host.prepend(style);
  return { host, state: host.querySelector<HTMLElement>('.setup-state')!, native: host.querySelector<HTMLElement>('.setup-native')!, observer: host.querySelector<HTMLElement>('.setup-observer')!,
    local: host.querySelector<HTMLElement>('.setup-local-guide')!, external: host.querySelector<HTMLElement>('.setup-external-guide')! };
}

export function mountLiveSetup(container: HTMLElement) {
  const ui = elements(); container.append(ui.host); let disposed = false, external = false, panel = false, externalObserver: Observer = 'unavailable', active: boolean | undefined, dto = projection(undefined);
  const paint = () => {
    if (disposed) return;
    if (external) {
      ui.local.hidden = true; ui.external.hidden = false;
      const paused = externalObserver === 'ready' && active === false;
      const values = [[ui.state, 'MCP bên ngoài'], [ui.native, 'Hội thoại thuộc Codex Desktop bên ngoài; Fisch không biết phiên Native đã chọn hay trạng thái trả lời.'],
        [ui.observer, paused ? 'Observer đang tạm dừng; kiểm tra lỗi trong terminal rồi khởi chạy lại host. Hội thoại Native vẫn độc lập.' : observerMessages[externalObserver]] ] as const;
      for (const [element, text] of values) if (element.textContent !== text) element.textContent = text;
      const title = ui.host.querySelector('.dialog-heading h2'), close = ui.host.querySelector('.dialog-heading button[aria-label]');
      if (title && title.textContent !== 'Kết nối · MCP bên ngoài') title.textContent = 'Kết nối · MCP bên ngoài';
      if (close && close.getAttribute('aria-label') !== 'Đóng Kết nối · MCP bên ngoài') close.setAttribute('aria-label', 'Đóng Kết nối · MCP bên ngoài');
      return;
    }
    const native = panel ? (dto.native === 'connected' ? 'Codex đã chọn thread do panel sở hữu; chưa xác nhận lượt trả lời.' : 'Đang khởi tạo Codex cho panel; chưa thể gửi.') : dto.native === 'connected'
      ? 'Native Codex đã chọn phiên; chưa xác nhận lượt trả lời.'
      : dto.native === 'waiting' ? 'Native Codex đang chờ chọn phiên trong terminal.' : 'Chưa xác nhận phiên Native Codex.';
    const paused = active === false && dto.observer === 'ready';
    const observer = paused ? 'Codex chủ động chưa khả dụng. Kiểm tra đăng nhập hoặc lỗi trong terminal rồi khởi chạy lại Fisch; chat vẫn độc lập.' : observerMessages[dto.observer];
    const label = paused ? 'Đang tạm dừng' : dto.observer === 'disabled_by_config' ? 'Đã tắt chủ động' : !['ready', 'unavailable'].includes(dto.observer) ? 'Cần kiểm tra' : dto.native !== 'connected' ? 'Chờ Codex' : dto.observer === 'ready' ? 'Đã cấu hình' : 'Chưa sẵn sàng';
    if (ui.state.textContent !== label) ui.state.textContent = label;
    if (ui.native.textContent !== native) ui.native.textContent = native;
    if (ui.observer.textContent !== observer) ui.observer.textContent = observer;
  };
  const project = (value: unknown) => { if (!disposed) { dto = projection(value); paint(); } };
  project(undefined);
  return { project, panelOwner: () => { panel = true; ui.local.textContent = 'Gửi tin nhắn và xử lý yêu cầu Native trong panel. Không tự cấp quyền hoặc gắn vào hội thoại Desktop bên ngoài. Camera vẫn cần bật và cấp quyền riêng; caption observer nằm ở nhật ký riêng. Reload hoặc đóng trang cần khởi chạy lại; không tự gửi lại yêu cầu cũ.'; paint(); }, externalHost: () => { external = true; paint(); }, externalObserver: (value: unknown) => {
    externalObserver = typeof value === 'string' && Object.hasOwn(observerMessages, value) ? value as Observer : 'unavailable'; paint();
  }, observerState: (value: boolean | undefined) => { active = value; paint(); }, dispose: () => { if (!disposed) { disposed = true; ui.host.remove(); } } };
}
