type Message = { id: string; turn: string; role: 'user' | 'assistant'; text: string; status: string; truncated: boolean };
type Snapshot = { generation: number; revision: number; ownerTurn: string | null; available: boolean; canSend: boolean; canCancel: boolean; pending: boolean; stopping: boolean; waiting: boolean; error: string; messages: Message[] };
type Request = (value: { action: 'send' | 'cancel'; generation: number; text?: string }) => Promise<unknown>;
type CancelScope = { generation: number; revision: number; ownerTurn: string | null };
const cancelSettled = (state: Snapshot, scope: CancelScope) => state.generation === scope.generation &&
  state.revision > scope.revision && state.ownerTurn !== scope.ownerTurn;
let mounts = 0;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const errors: Record<string, string> = {
  conversation_unknown: 'Chưa rõ yêu cầu đã được nhận. Không gửi lại; kiểm tra terminal hoặc khởi chạy lại Live.',
  conversation_expression_failed: 'Một yêu cầu biểu đạt báo lỗi. Lượt trả lời hoàn tất không xác nhận tạo hình thành công; kiểm tra terminal.',
  conversation_completion_unknown: 'Chưa xác nhận kết quả lượt trả lời. Kiểm tra terminal.',
  conversation_restart_required: 'Phiên đã chuyển trang; hãy khởi chạy lại Live.',
  conversation_rejected: 'Yêu cầu chưa được nhận. Bản nháp vẫn được giữ để bạn kiểm tra.',
  conversation_changed: 'Phiên đang thay đổi. Kiểm tra terminal trước khi gửi.',
  conversation_unavailable: 'Chưa thể gửi trong phiên này. Kiểm tra terminal.',
  conversation_capacity: 'Đã đạt giới hạn phiên; hãy khởi chạy lại Live.',
  conversation_no_turn: 'Chưa có lượt trả lời hiện tại để dừng.',
  conversation_stop_unconfirmed: 'Chưa xác nhận đã dừng trả lời. Kiểm tra terminal.',
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
    <div class="observation-messages" role="log" aria-label="Fisch chủ động từ quan sát" style="max-height:160px;overflow:auto;flex:none;white-space:pre-wrap"></div><p class="conversation-status" role="status" aria-live="polite" aria-atomic="true"></p>
    <form><label>Nhắn trong phiên hiện tại<textarea rows="2" maxlength="16000" aria-describedby="${limitId}"></textarea></label>
    <p id="${limitId}" class="conversation-count"></p><div class="conversation-actions"><button type="submit">Gửi</button><button type="button">Dừng trả lời</button></div></form>`;
  return { host, list: host.querySelector('ol')!, status: host.querySelector<HTMLElement>('.conversation-status')!, count: host.querySelector<HTMLElement>('.conversation-count')!,
    input: host.querySelector('textarea')!, form: host.querySelector('form')!, send: host.querySelector<HTMLButtonElement>('button[type=submit]')!, cancel: host.querySelector<HTMLButtonElement>('button[type=button]')! };
}
function messageText(item: Message) {
  const status: Record<string, string> = { streaming: 'Đang nhận', completed: 'Đã hoàn tất', interrupted: 'Đã ngắt', failed: 'Lượt lỗi', unknown: 'Chưa rõ kết quả' };
  return `${item.role === 'user' ? 'Bạn' : 'Codex'}: ${item.text}\n[${status[item.status]}${item.truncated ? ' · Đã rút gọn phần hiển thị' : ''}]`;
}
function projectMessages(ui: ReturnType<typeof elements>, next: Snapshot) {
  const top = ui.list.scrollTop, bottom = top + ui.list.clientHeight >= ui.list.scrollHeight - 40;
  const texts = next.messages.map(messageText);
  if (JSON.stringify([...ui.list.children].map(node => node.textContent)) !== JSON.stringify(texts)) {
    ui.list.replaceChildren(...texts.map(text => { const node = document.createElement('li'); node.textContent = text; return node; }));
    ui.list.scrollTop = bottom ? ui.list.scrollHeight : top;
  }
}
function statusText(state: Snapshot | undefined, busy: boolean) {
  return state?.error ? errors[state.error] : !state?.available ? 'Chọn hoặc bắt đầu phiên trong terminal Native Codex đang chạy cùng Fisch.' :
    state.waiting ? 'Codex cần bạn xác nhận trong terminal.' : state.stopping ? 'Đang dừng trả lời; chưa xác nhận đã dừng.' :
    state.pending || busy ? 'Đang gửi; chưa xác nhận kết quả.' : state.canSend ? 'Bạn có thể nhắn trong phiên hiện tại.' : 'Phiên đang bận hoặc đang được chọn trong terminal.';
}
function reactionView(host: HTMLElement, disposed: () => boolean) {
  const reactionIds = new Set<string>();
  function reaction(value: { requestId: string; text: string }) {
    if (disposed() || !value || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.requestId) || reactionIds.has(value.requestId) || typeof value.text !== 'string' || value.text.length > 600 || !value.text.trim()) return false;
    reactionIds.add(value.requestId); if (reactionIds.size > 128) reactionIds.delete(reactionIds.values().next().value!);
    const list = host.querySelector('.observation-messages')!, item = document.createElement('div');
    item.dataset.requestId = value.requestId; item.textContent = 'Fisch · chủ động: ' + value.text; list.append(item);
    while (list.children.length > 24) list.firstChild?.remove(); list.scrollTop = list.scrollHeight; return true;
  }
  return { publish: reaction, clear: () => { reactionIds.clear(); host.querySelector('.observation-messages')?.replaceChildren(); } };
}
function paintConversation(ui: ReturnType<typeof elements>, state: Snapshot | undefined, flags: { disposed: boolean; busy: boolean; cancelling: boolean; localError: string; lock: boolean; acknowledged: number }) {
    const { disposed, busy, cancelling, localError, lock, acknowledged } = flags;
    const length = bytes(ui.input.value), invalid = !ui.input.value.trim() || length > 16000;
    ui.count.textContent = `${length} / 16000 byte UTF-8 · chỉ gửi khi bạn bấm Gửi.`;
    ui.input.disabled = disposed || !state?.available;
    ui.send.disabled = !state?.canSend || busy || lock || state?.error === 'conversation_unknown' || state?.revision === acknowledged || invalid;
    ui.cancel.disabled = !state?.canCancel || cancelling;
    const text = localError || statusText(state, busy);
    if (ui.status.textContent !== text) ui.status.textContent = text;
  }
export function mountConversation(container: HTMLElement, request: Request) {
  const ui = elements(); container.append(ui.host);
  let state: Snapshot | undefined, disposed = false, attempt = 0, busy = false, cancelling = false, localError = '', lock = false, acknowledged = -1, highGeneration = -1, highRevision = -1, cleared = false;
  const reactions = reactionView(ui.host, () => disposed);
  let cancelScope: CancelScope | undefined, localCancelError: CancelScope | undefined;
  const paint = () => paintConversation(ui, state, { disposed, busy, cancelling, localError, lock, acknowledged });
  function clear() { reactions.clear(); cleared = true; attempt++; busy = false; cancelling = false; cancelScope = localCancelError = undefined; lock = false; acknowledged = -1; localError = ''; ui.input.value = ''; ui.list.replaceChildren(); state = undefined; paint(); }
  function project(value: unknown) {
    if (disposed) return;
    const next = snapshot(value);
    if (!next) { clear(); return; }
    if (next.generation < highGeneration || next.generation === highGeneration && (next.revision < highRevision || cleared && next.revision === highRevision)) return;
    if (state && next.generation !== state.generation) clear();
    state = next; highGeneration = next.generation; highRevision = next.revision; cleared = false;
    if (cancelScope && cancelSettled(next, cancelScope)) { cancelScope = undefined; cancelling = false; }
    if (localCancelError && cancelSettled(next, localCancelError)) { localError = ''; localCancelError = undefined; }
    projectMessages(ui, next);
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
  ui.input.oninput = paint; ui.form.onsubmit = event => { event.preventDefault(); void act('send'); }; ui.cancel.onclick = () => { void act('cancel'); }; paint();
  return { project, clear, reaction: reactions.publish, dispose: () => { if (disposed) return; clear(); disposed = true; ui.input.oninput = null; ui.form.onsubmit = null; ui.cancel.onclick = null; ui.host.remove(); } };
}
