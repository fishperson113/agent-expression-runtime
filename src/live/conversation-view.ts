type Message = { id: string; turn: string; role: 'user' | 'assistant'; text: string; status: string; truncated: boolean };
type Snapshot = { generation: number; revision: number; available: boolean; canSend: boolean; canCancel: boolean; pending: boolean; stopping: boolean; waiting: boolean; error: string; messages: Message[] };
type Request = (value: { action: 'send' | 'cancel'; generation: number; text?: string }) => Promise<unknown>;
let mounts = 0;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const errors: Record<string, string> = {
  conversation_unknown: 'Chưa rõ yêu cầu đã được nhận. Không gửi lại; kiểm tra terminal hoặc khởi chạy lại Live.',
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
    const dto = record(value), keys = ['generation', 'revision', 'available', 'canSend', 'canCancel', 'pending', 'stopping', 'waiting', 'error', 'messages'];
    if (Object.keys(dto).length !== keys.length || Object.keys(dto).some(key => !keys.includes(key))) return;
    if (!['generation', 'revision'].every(key => Number.isSafeInteger(dto[key]) && (dto[key] as number) >= 0)) return;
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
    <p class="conversation-status" role="status" aria-live="polite" aria-atomic="true"></p>
    <form><label>Nhắn trong phiên hiện tại<textarea rows="2" maxlength="16000" aria-describedby="${limitId}"></textarea></label>
    <p id="${limitId}" class="conversation-count"></p><div class="conversation-actions"><button type="submit">Gửi</button><button type="button">Dừng trả lời</button></div></form>`;
  return { host, list: host.querySelector('ol')!, status: host.querySelector<HTMLElement>('.conversation-status')!, count: host.querySelector<HTMLElement>('.conversation-count')!,
    input: host.querySelector('textarea')!, form: host.querySelector('form')!, send: host.querySelector<HTMLButtonElement>('button[type=submit]')!, cancel: host.querySelector<HTMLButtonElement>('button[type=button]')! };
}
function messageText(item: Message) {
  const status: Record<string, string> = { streaming: 'Đang nhận', completed: 'Đã hoàn tất', interrupted: 'Đã ngắt', failed: 'Lượt lỗi', unknown: 'Chưa rõ kết quả' };
  return `${item.role === 'user' ? 'Bạn' : 'Codex'}: ${item.text}\n[${status[item.status]}${item.truncated ? ' · Đã rút gọn phần hiển thị' : ''}]`;
}
export function mountConversation(container: HTMLElement, request: Request) {
  const ui = elements(); container.append(ui.host);
  let state: Snapshot | undefined, disposed = false, attempt = 0, busy = false, cancelling = false, localError = '', lock = false, acknowledged = -1, highGeneration = -1, highRevision = -1, cleared = false;
  function paint() {
    const length = bytes(ui.input.value), invalid = !ui.input.value.trim() || length > 16000;
    ui.count.textContent = `${length} / 16000 byte UTF-8 · chỉ gửi khi bạn bấm Gửi.`;
    ui.input.disabled = disposed || !state?.available;
    ui.send.disabled = !state?.canSend || busy || lock || state?.error === 'conversation_unknown' || state?.revision === acknowledged || invalid;
    ui.cancel.disabled = !state?.canCancel || cancelling;
    const text = localError || (state?.error ? errors[state.error] : !state?.available ? 'Chọn hoặc bắt đầu phiên trong terminal Native Codex đang chạy cùng Fisch.' :
      state.waiting ? 'Codex cần bạn xác nhận trong terminal.' : state.stopping ? 'Đang dừng trả lời; chưa xác nhận đã dừng.' :
      state.pending || busy ? 'Đang gửi; chưa xác nhận kết quả.' : state.canSend ? 'Bạn có thể nhắn trong phiên hiện tại.' : 'Phiên đang bận hoặc đang được chọn trong terminal.');
    if (ui.status.textContent !== text) ui.status.textContent = text;
  }
  function clear() { cleared = true; attempt++; busy = false; cancelling = false; lock = false; acknowledged = -1; localError = ''; ui.input.value = ''; ui.list.replaceChildren(); state = undefined; paint(); }
  function project(value: unknown) {
    if (disposed) return;
    const next = snapshot(value);
    if (!next) { clear(); return; }
    if (next.generation < highGeneration || next.generation === highGeneration && (next.revision < highRevision || cleared && next.revision === highRevision)) return;
    if (state && next.generation !== state.generation) clear();
    state = next; highGeneration = next.generation; highRevision = next.revision; cleared = false;
    const top = ui.list.scrollTop, bottom = top + ui.list.clientHeight >= ui.list.scrollHeight - 40;
    const texts = next.messages.map(messageText);
    if (JSON.stringify([...ui.list.children].map(node => node.textContent)) !== JSON.stringify(texts)) {
      ui.list.replaceChildren(...texts.map(text => { const node = document.createElement('li'); node.textContent = text; return node; }));
      ui.list.scrollTop = bottom ? ui.list.scrollHeight : top;
    }
    paint();
  }
  async function act(action: 'send' | 'cancel') {
    if (disposed || !state || (action === 'send' ? ui.send.disabled : ui.cancel.disabled)) return;
    const current = attempt, generation = state.generation, revision = state.revision, text = ui.input.value;
    if (action === 'send') busy = true; else cancelling = true; localError = ''; paint();
    try {
      const reply = record(await request({ action, generation, ...(action === 'send' ? { text } : {}) }));
      if (reply.status !== (action === 'send' ? 'accepted' : 'stopping')) throw Error('conversation_unknown');
      if (disposed || current !== attempt || state?.generation !== generation) return;
      if (action === 'send') { acknowledged = revision; if (ui.input.value === text) ui.input.value = ''; }
    } catch (error) {
      if (disposed || current !== attempt || state?.generation !== generation) return;
      const code = error instanceof Error ? error.message : '';
      localError = errors[code] || errors.conversation_unknown;
      if (action === 'send' && !['conversation_rejected', 'conversation_invalid_text', 'conversation_changed', 'conversation_unavailable'].includes(code)) lock = true;
    } finally { if (!disposed && current === attempt) { if (action === 'send') busy = false; else cancelling = false; paint(); } }
  }
  ui.input.oninput = paint; ui.form.onsubmit = event => { event.preventDefault(); void act('send'); }; ui.cancel.onclick = () => { void act('cancel'); }; paint();
  return { project, clear, dispose: () => { if (disposed) return; clear(); disposed = true; ui.input.oninput = null; ui.form.onsubmit = null; ui.cancel.onclick = null; ui.host.remove(); } };
}
