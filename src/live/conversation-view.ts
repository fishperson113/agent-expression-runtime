type Message = { id: string; turn: string; role: 'user' | 'assistant'; text: string; status: string; truncated: boolean };
type Snapshot = { generation: number; revision: number; ownerTurn: string | null; available: boolean; canSend: boolean; canCancel: boolean; pending: boolean; stopping: boolean; waiting: boolean; error: string; messages: Message[] };
type Request = (value: { action: 'send' | 'cancel'; generation: number; text?: string }) => Promise<unknown>;
type CancelScope = { generation: number; revision: number; ownerTurn: string | null };
const cancelSettled = (state: Snapshot, scope: CancelScope) => state.generation === scope.generation &&
  state.revision > scope.revision && state.ownerTurn !== scope.ownerTurn;
let mounts = 0;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const errors: Record<string, string> = {
  conversation_transport_lost: 'Mất kết nối Codex; text dở chưa được xác nhận hoàn tất. Không tự gửi lại. Dừng Live rồi khởi chạy lại để kết nối.',
  conversation_startup_failed: 'Codex chưa thể khởi tạo phiên. Mã lỗi nằm trong mục Yêu cầu và công cụ. Hãy dừng Live và kiểm tra môi trường Codex trước khi khởi chạy lại.',
  conversation_unknown: 'Chưa rõ yêu cầu đã được nhận. Không gửi lại; kiểm tra kết nối Codex hoặc khởi chạy lại Live.',
  conversation_expression_failed: 'Một yêu cầu biểu đạt báo lỗi. Lượt trả lời hoàn tất không xác nhận tạo hình thành công; kiểm tra kết nối Codex.',
  conversation_completion_unknown: 'Chưa xác nhận kết quả lượt trả lời. Kiểm tra kết nối Codex.',
  conversation_restart_required: 'Phiên đã chuyển trang; hãy khởi chạy lại Live.',
  conversation_rejected: 'Yêu cầu chưa được nhận. Bản nháp vẫn được giữ để bạn kiểm tra.',
  conversation_changed: 'Phiên đang thay đổi. Kiểm tra kết nối Codex trước khi gửi.',
  conversation_unavailable: 'Chưa thể gửi trong phiên này. Kiểm tra kết nối Codex.',
  conversation_capacity: 'Đã đạt giới hạn phiên; hãy khởi chạy lại Live.',
  conversation_no_turn: 'Chưa có lượt trả lời hiện tại để dừng.',
  conversation_stop_unconfirmed: 'Chưa xác nhận đã dừng trả lời. Kiểm tra kết nối Codex.',
  conversation_invalid_text: 'Nhập nội dung không trống, tối đa 16000 byte UTF-8.'
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !('value' in descriptors[key])) throw Error();
    result[key] = descriptors[key].value;
  }
  return result;
}
function snapshot(value: unknown): Snapshot | undefined {
  try {
    const dto = record(value), keys = ['generation', 'revision', 'available', 'canSend', 'canCancel', 'pending', 'stopping', 'waiting', 'error', 'messages', 'ownerTurn'];
    if (Object.keys(dto).length !== keys.length || Object.keys(dto).some(key => !keys.includes(key))) return;
    if (!['generation', 'revision'].every(key => Number.isSafeInteger(dto[key]) && (dto[key] as number) >= 0)) return;
    if (dto.ownerTurn !== null && (typeof dto.ownerTurn !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(dto.ownerTurn))) return;
    if (!keys.slice(2, 8).every(key => typeof dto[key] === 'boolean') || typeof dto.error !== 'string' ||
      (dto.error !== '' && !Object.hasOwn(errors, dto.error)) || !Array.isArray(dto.messages)) return;
    let total = 0;
    const entries = Object.getOwnPropertyDescriptors(dto.messages) as Record<string, PropertyDescriptor>, length = entries.length.value;
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > 80) return;
    const messages = Array.from({ length }, (_, index) => {
      const descriptor = entries[index]; if (!descriptor || !('value' in descriptor)) throw Error();
      const raw = descriptor.value;
      const item = record(raw);
      if (Object.keys(item).length !== 6 || !['id', 'turn'].every(key => typeof item[key] === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(item[key] as string)) ||
        !['user', 'assistant'].includes(item.role as string) || typeof item.text !== 'string' || bytes(item.text) > 64000 ||
        !['streaming', 'completed', 'interrupted', 'failed', 'unknown'].includes(item.status as string) || typeof item.truncated !== 'boolean') throw Error();
      total += bytes(item.text); if (total > 128000) throw Error();
      return item as Message;
    });
    return { ...dto, messages } as Snapshot;
  } catch { return; }
}
function elements() {
  const host = document.createElement('section'); host.className = 'fisch-conversation'; const limitId = `conversation-byte-limit-${++mounts}`; host.setAttribute('aria-label', 'Trò chuyện với phiên Codex hiện tại');
  host.innerHTML = `<style>.fisch-conversation{display:flex;flex-direction:column;min-height:0;min-width:0;gap:8px}.fisch-conversation ol{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;list-style:none;padding:0;margin:0;overflow-wrap:anywhere}.fisch-conversation li{white-space:pre-wrap;padding:8px 0}.fisch-conversation form{flex-shrink:0;display:grid;gap:6px}.fisch-conversation textarea{box-sizing:border-box;width:100%;min-width:0;resize:none;background:var(--bg,#080e14);color:inherit;font:inherit;border:1px solid var(--line,#344650);border-radius:6px;padding:8px}.fisch-conversation p{font-size:12px;margin:0;overflow-wrap:anywhere}.fisch-conversation .conversation-actions{display:flex;gap:8px;flex-wrap:wrap}.fisch-conversation button{min-height:40px}.fisch-conversation :focus-visible{outline:2px solid var(--focus,#fff);outline-offset:2px}</style>
    <h2>Trò chuyện với Codex</h2><ol tabindex="0" aria-label="Nội dung phiên Codex hiện tại"></ol>
    <div class="observation-messages" tabindex="0" role="log" aria-label="Fisch chủ động từ quan sát" style="max-height:var(--reaction-log-max-height,160px);overflow:auto;flex:none;white-space:pre-wrap"></div><p class="conversation-status" role="status" aria-live="polite" aria-atomic="true"></p>
    <form class="conversation-composer"><label><span class="composer-label">Nhắn trong phiên hiện tại</span><textarea rows="2" maxlength="16000" placeholder="Nhắn với Codex…" aria-describedby="${limitId}" enterkeyhint="send"></textarea></label>
    <div class="conversation-actions"><p id="${limitId}" class="conversation-count"></p><button type="submit">Gửi</button><button type="button">Dừng trả lời</button></div></form>`;
  return { host, list: host.querySelector('ol')!, status: host.querySelector<HTMLElement>('.conversation-status')!, count: host.querySelector<HTMLElement>('.conversation-count')!,
    input: host.querySelector('textarea')!, form: host.querySelector('form')!, send: host.querySelector<HTMLButtonElement>('button[type=submit]')!, cancel: host.querySelector<HTMLButtonElement>('button[type=button]')! };
}
function messageText(item: Message) {
  const status: Record<string, string> = { streaming: 'Đang nhận', completed: 'Đã hoàn tất', interrupted: 'Đã ngắt', failed: 'Lượt lỗi', unknown: 'Chưa rõ kết quả' };
  return `${item.role === 'user' ? 'Bạn' : 'Codex'}: ${item.text}\n[${status[item.status]}${item.truncated ? ' · Đã rút gọn phần hiển thị' : ''}]`;
}
function updateMessageText(node: Text, text: string) {
  const previous = node.data;
  if (previous === text) return;
  let start = 0, end = 0;
  while (start < previous.length && start < text.length && previous[start] === text[start]) start++;
  while (end < previous.length - start && end < text.length - start &&
    previous[previous.length - end - 1] === text[text.length - end - 1]) end++;
  node.replaceData(start, previous.length - start - end, text.slice(start, text.length - end));
}
function messageRows(list: HTMLOListElement) {
  let rows = new Map<string, HTMLLIElement>();
  return {
    reconcile(next: Snapshot) {
      const retained = new Map<string, HTMLLIElement>(), occurrences = new Map<string, number>();
      let cursor = list.firstChild;
      for (const item of next.messages) {
        const identity = JSON.stringify([next.generation, item.turn, item.id, item.role]);
        const occurrence = occurrences.get(identity) ?? 0; occurrences.set(identity, occurrence + 1);
        const key = identity + ':' + occurrence;
        let node = rows.get(key);
        if (!node) { node = document.createElement('li'); node.append(document.createTextNode('')); }
        updateMessageText(node.firstChild as Text, messageText(item));
        if (node !== cursor) list.insertBefore(node, cursor);
        cursor = node.nextSibling; retained.set(key, node);
      }
      for (const [key, node] of rows) if (!retained.has(key)) node.remove();
      rows = retained;
    },
    clear() { rows.clear(); list.replaceChildren(); }
  };
}
function messageProjection(list: HTMLOListElement) {
  const rows = messageRows(list);
  const measure = () => ({ top: list.scrollTop, height: list.clientHeight, total: list.scrollHeight });
  let following = true, resizing = false, frame = 0, layout = measure();
  const settle = () => {
    capture(); if (following) list.scrollTop = list.scrollHeight;
    layout = measure(); resizing = false; if (frame) cancelAnimationFrame(frame); frame = 0;
  };
  const capture = () => {
    const next = measure();
    // A resize-generated scroll must not overwrite the reader's prior follow intent.
    if (next.height !== layout.height || next.total !== layout.total) { resizing = true; if (!frame) frame = requestAnimationFrame(settle); }
    if (!resizing) following = next.top + next.height >= next.total - 40;
    layout = next; return next;
  };
  const readerScroll = (event: Event) => {
    if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
    if (event.type === 'pointermove' && !((event as PointerEvent).buttons > 0)) return;
    if (event.type === 'touchmove' && !(event as TouchEvent).touches?.length) return;
    resizing = false; layout = measure(); following = layout.top + layout.height >= layout.total - 40;
  };
  const inputs = ['wheel', 'keydown', 'pointerdown', 'touchstart', 'pointermove', 'touchmove'];
  for (const type of inputs) list.addEventListener(type, readerScroll, { passive: true });
  const resize = new ResizeObserver(settle);
  list.addEventListener('scroll', capture); resize.observe(list);
  return {
    project(next: Snapshot) {
      const before = capture();
      rows.reconcile(next);
      list.scrollTop = following ? list.scrollHeight : before.top; layout = measure(); resizing = false;
    },
    clear() { following = true; resizing = false; if (frame) cancelAnimationFrame(frame); frame = 0; rows.clear(); layout = measure(); },
    dispose() { resize.disconnect(); if (frame) cancelAnimationFrame(frame); list.removeEventListener('scroll', capture); for (const type of inputs) list.removeEventListener(type, readerScroll); }
  };
}
function statusText(state: Snapshot | undefined, busy: boolean, panel = false) {
  if (panel && !state?.error && (!state?.available || state.waiting)) return state?.available ? 'Codex cần lựa chọn trong mục Yêu cầu và công cụ.' : 'Đang khởi tạo thread Codex của panel; chưa thể gửi.';
  return state?.error ? errors[state.error] : !state?.available ? 'Chọn hoặc bắt đầu phiên trong terminal Native Codex đang chạy cùng Fisch.' :
    state.waiting ? 'Codex cần bạn xác nhận trong terminal.' : state.stopping ? 'Đang dừng trả lời; chưa xác nhận đã dừng.' :
    state.pending || busy ? 'Đang gửi; chưa xác nhận kết quả.' : state.canSend ? 'Bạn có thể nhắn trong phiên hiện tại.' : 'Phiên đang bận hoặc đang thay đổi.';
}
function reactionView(host: HTMLElement, disposed: () => boolean) {
  const reactionIds = new Set<string>();
  let history: { requestId: string; text: string; at: number }[] = [];
  const snapshot = () => { const now = performance.now(); history = history.filter(item => now >= item.at && now - item.at < 300000);
    return history.map(({ requestId, text, at }) => ({ requestId, text, ageMs: now - at })); };
  function reaction(value: { requestId: string; text: string }) {
    if (disposed() || !value || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.requestId) || reactionIds.has(value.requestId) || typeof value.text !== 'string' || value.text.length > 600 || !value.text.trim()) return false;
    reactionIds.add(value.requestId); if (reactionIds.size > 128) reactionIds.delete(reactionIds.values().next().value!);
    const list = host.querySelector('.observation-messages')!, item = document.createElement('div');
    item.dataset.requestId = value.requestId; item.textContent = 'Fisch · chủ động: ' + value.text; list.append(item);
    snapshot(); history.push({ requestId: value.requestId, text: value.text, at: performance.now() });
    while (history.length > 8 || history.reduce((sum, item) => sum + item.text.length, 0) > 2400) history.shift();
    while (list.children.length > 24) list.firstChild?.remove(); list.scrollTop = list.scrollHeight; return true;
  }
  return { publish: reaction, snapshot, clear: () => { history = []; reactionIds.clear(); host.querySelector('.observation-messages')?.replaceChildren(); } };
}
function paintConversation(ui: ReturnType<typeof elements>, state: Snapshot | undefined, flags: { disposed: boolean; busy: boolean; cancelling: boolean; localError: string; lock: boolean; acknowledged: number; panel: boolean }) {
    const { disposed, busy, cancelling, localError, lock, acknowledged } = flags;
    const length = bytes(ui.input.value), invalid = !ui.input.value.trim() || length > 16000;
    ui.count.textContent = length > 12000 ? `${length} / 16000 byte UTF-8` : 'Enter gửi · Shift+Enter xuống dòng';
    ui.input.setAttribute('aria-invalid', String(length > 16000));
    ui.input.disabled = disposed || !state?.available;
    ui.send.disabled = !state?.canSend || busy || lock || state?.error === 'conversation_unknown' || state?.revision === acknowledged || invalid;
    ui.cancel.disabled = !state?.canCancel || cancelling;
    const text = localError || statusText(state, busy, flags.panel);
    if (ui.status.textContent !== text) ui.status.textContent = text;
  }
export function mountConversation(container: HTMLElement, request: Request) {
  const ui = elements(); container.append(ui.host);
  let state: Snapshot | undefined, disposed = false, attempt = 0, busy = false, cancelling = false, localError = '', lock = false, acknowledged = -1, highGeneration = -1, highRevision = -1, cleared = false;
  let panel = false;
  const reactions = reactionView(ui.host, () => disposed);
  const messages = messageProjection(ui.list);
  let cancelScope: CancelScope | undefined, localCancelError: CancelScope | undefined;
  const paint = () => paintConversation(ui, state, { disposed, busy, cancelling, localError, lock, acknowledged, panel });
  function clear() { reactions.clear(); cleared = true; attempt++; busy = false; cancelling = false; cancelScope = localCancelError = undefined; lock = false; acknowledged = -1; localError = ''; ui.input.value = ''; messages.clear(); state = undefined; paint(); }
  function project(value: unknown) {
    if (disposed) return;
    const next = snapshot(value);
    if (!next) { clear(); return; }
    if (next.generation < highGeneration || next.generation === highGeneration && (next.revision < highRevision || cleared && next.revision === highRevision)) return;
    if (state && next.generation !== state.generation) clear();
    state = next; highGeneration = next.generation; highRevision = next.revision; cleared = false;
    if (cancelScope && cancelSettled(next, cancelScope)) { cancelScope = undefined; cancelling = false; }
    if (localCancelError && cancelSettled(next, localCancelError)) { localError = ''; localCancelError = undefined; }
    messages.project(next);
    paint();
  }
  async function act(action: 'send' | 'cancel') {
    if (disposed || !state || (action === 'send' ? ui.send.disabled : ui.cancel.disabled)) return;
    const current = attempt, generation = state.generation, revision = state.revision, text = ui.input.value,
      scope = action === 'cancel' ? { generation, revision, ownerTurn: state.ownerTurn } : undefined;
    cancelScope = scope; localCancelError = undefined;
    if (action === 'send') { busy = true; cancelling = false; } else cancelling = true; localError = ''; paint();
    try {
      const reply = record(await request({ action, generation, ...(action === 'send' ? { text } : {}) }));
      if (reply.status !== (action === 'send' ? 'accepted' : 'stopping')) throw Error('conversation_unknown');
      if (disposed || current !== attempt || state?.generation !== generation) return;
      if (action === 'send') { acknowledged = revision; if (ui.input.value === text) ui.input.value = ''; }
    } catch (error) {
      if (disposed || current !== attempt || state?.generation !== generation) return;
      if (action === 'cancel' && cancelScope !== scope) return;
      if (action === 'cancel' && (lock || state.error === 'conversation_unknown')) return;
      const code = error instanceof Error ? error.message : '';
      localError = errors[code] || errors.conversation_unknown;
      localCancelError = action === 'cancel' ? scope : undefined;
      if (action === 'send' && !['conversation_rejected', 'conversation_invalid_text', 'conversation_changed', 'conversation_unavailable'].includes(code)) lock = true;
    } finally { if (!disposed && current === attempt) { if (action === 'send') busy = false; else if (cancelScope === scope) cancelling = false; paint(); } }
  }
  ui.input.oninput = paint; ui.input.onkeydown = event => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault(); if (!event.repeat && !ui.send.disabled) ui.form.requestSubmit();
  }; ui.form.onsubmit = event => { event.preventDefault(); void act('send'); }; ui.cancel.onclick = () => { void act('cancel'); }; paint();
  return { project, clear, panelOwner: () => { panel = true; paint(); }, reaction: reactions.publish, reactionHistory: reactions.snapshot, dispose: () => { if (disposed) return; clear(); disposed = true; messages.dispose(); ui.input.oninput = null; ui.input.onkeydown = null; ui.form.onsubmit = null; ui.cancel.onclick = null; ui.host.remove(); } };
}
