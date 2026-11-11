type Id = string | number;
export type PanelResponse = { id: Id; decision: 'accept' | 'decline' | 'cancel' } | { id: Id; answers: Record<string, { answers: string[] }> };
type Data = Record<string, any>;
type Control = Data & { type: 'request'; id: Id; method: string; threadId: string; turnId: string; itemId: string; details: Data; choices: string[] };
type Entry = { control: Control; node: HTMLElement; info: HTMLElement; state: HTMLElement; sent: boolean; fingerprint: string };
const methods = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput'];
const reasons: Record<string, string> = {
  submitted: 'Đã gửi lựa chọn; chưa phải xác nhận Native.', server_resolved: 'Native đã kết thúc yêu cầu.',
  turn_terminal: 'Lượt đã kết thúc; yêu cầu không còn hiệu lực.', owner_changed: 'Phiên hoặc lượt đã đổi; yêu cầu cũ đã bỏ.',
  closed: 'Kết nối đã đóng; không thể phản hồi.', response_unknown: 'Chưa rõ lựa chọn đã được nhận. Không gửi lại; kiểm tra kết nối.'
};
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const label = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const id = (value: unknown): value is Id => label(value) || Number.isSafeInteger(value);
function copy(value: unknown, depth = 0, budget = { nodes: 0, text: 0 }): any {
  if (depth > 12 || ++budget.nodes > 2048) throw Error();
  if (typeof value === 'string') { budget.text += new TextEncoder().encode(value).length; if (budget.text > 32768) throw Error(); }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(value))) throw Error();
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !('value' in fields[key]))) throw Error();
  if (Array.isArray(value)) {
    if (value.length > 512) throw Error();
    return Array.from({ length: value.length }, (_, index) => { if (!fields[index]) throw Error(); return copy(fields[index].value, depth + 1, budget); });
  }
  const result: Data = Object.create(null);
  for (const [key, item] of Object.entries(fields)) { budget.text += key.length; if (budget.text > 32768) throw Error(); result[key] = copy(item.value, depth + 1, budget); }
  return result;
}
export function parsePanelControl(value: unknown): Data | undefined {
  try {
    const dto = copy(value); if (!dto || bytes(dto) > 32768) return;
    if (dto.type === 'unsupported') return id(dto.id) && label(dto.method) && dto.reason === 'unsupported_or_unavailable' ? dto : undefined;
    if (![dto.threadId, dto.turnId].every(label)) return;
    if (dto.type === 'resolved') return id(dto.id) && Object.hasOwn(reasons, dto.reason) ? dto : undefined;
    if (dto.type === 'tool') return ['started', 'completed'].includes(dto.phase) && dto.item && label(dto.item.id) &&
      ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch'].includes(dto.item.type) && bytes(dto.item) <= 16384 ? dto : undefined;
    if (dto.type !== 'request' || !id(dto.id) || !label(dto.itemId) || !methods.includes(dto.method) || !dto.details || bytes(dto.details) > 16384 ||
        !Array.isArray(dto.choices) || dto.choices.length > 3 || new Set(dto.choices).size !== dto.choices.length || dto.choices.some((v: string) => !['accept', 'decline', 'cancel'].includes(v))) return;
    if (dto.method !== methods[2]) return dto;
    const questions = dto.details.questions, ids = new Set();
    if (dto.choices.length || !Array.isArray(questions) || !questions.length || questions.length > 8) return;
    for (const q of questions) {
      if (!q || !label(q.id) || ['__proto__', 'constructor', 'prototype'].includes(q.id) || ids.has(q.id) || q.isSecret || typeof q.header !== 'string' || typeof q.question !== 'string' ||
          q.isOther !== undefined && typeof q.isOther !== 'boolean') return;
      if (q.options != null && (!Array.isArray(q.options) || q.options.length > 16 || q.options.some((o: Data) => !o || typeof o.label !== 'string' || typeof o.description !== 'string'))) return;
      ids.add(q.id);
    }
    return dto;
  } catch { return; }
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') { const node = document.createElement(tag); node.textContent = text; return node; }
const key = (value: Data) => JSON.stringify([typeof value.id, value.id, value.threadId, value.turnId]);
const toolKey = (value: Data, itemId = value.item?.id) => JSON.stringify([value.threadId, value.turnId, itemId]);
function changes(item: Data | undefined): Data[] | undefined {
  const values = item?.changes;
  return item?.truncated !== true && Array.isArray(values) && values.length > 0 && values.every((v: Data) =>
    typeof v?.path === 'string' && typeof v?.diff === 'string' && ['add', 'delete', 'update'].includes(v?.kind?.type) &&
    (v.kind.move_path == null || typeof v.kind.move_path === 'string')) ? values : undefined;
}
function approvalInfo(control: Control, item?: Data) {
  const host = element('div'), p = control.details;
  if (typeof p.reason === 'string') host.append(element('p', p.reason));
  if (control.method === methods[0]) {
    host.append(element('p', 'Lệnh'), element('pre', typeof p.command === 'string' ? p.command : 'Native chưa cung cấp lệnh.'),
      element('p', 'Thư mục'), element('pre', typeof p.cwd === 'string' ? p.cwd : 'Native chưa cung cấp thư mục.'));
    return { host, informed: typeof p.command === 'string' && !!p.command && typeof p.cwd === 'string' && !!p.cwd && (!p.kind || p.kind === 'command') };
  }
  const files = changes(item);
  if (!files) host.append(element('p', 'Chưa có thay đổi tệp đầy đủ từ Native; không thể cho phép tại đây.'));
  for (const file of files ?? []) host.append(element('p', `${file.kind.type}: ${file.path}${file.kind.move_path ? ' → ' + file.kind.move_path : ''}`), element('pre', file.diff));
  if (p.grantRoot != null) host.append(element('p', 'Yêu cầu phạm vi thư mục không được phê duyệt tại panel này.'));
  return { host, informed: !!files && p.grantRoot == null };
}
let mounts = 0;
class PanelControls {
  private host: HTMLDetailsElement; private summary: HTMLElement; private list: HTMLElement; private status: HTMLElement;
  private pending = new Map<string, Entry>(); private tools = new Map<string, { value: Data; node: HTMLElement }>(); private settled = new Set<string>();
  private mount = ++mounts; private disposed = false; private serial = 0;
  private composerFocus = (event: Event) => { if (!this.pending.size && event.target instanceof HTMLTextAreaElement && event.target.closest('.fisch-conversation')) this.host.open = false; };
  constructor(private container: HTMLElement, private respond: (value: PanelResponse) => Promise<unknown>) {
    const host = element('details'), summary = element('summary', 'Yêu cầu và công cụ'), list = element('div'), status = element('p');
    host.className = 'fisch-panel-controls'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    host.append(summary, status, list); container.append(host);
    const style = element('style', `.fisch-panel-controls{flex:0 1 auto;min-width:0;min-height:30px;max-height:min(28vh,220px);overflow:auto;overflow-wrap:anywhere;border-top:1px solid var(--line,#344650);font-size:12px}.fisch-panel-controls summary{position:sticky;top:0;background:var(--bg,#080e14);padding:6px;cursor:pointer;z-index:1}.fisch-panel-controls article{padding:8px;border-top:1px solid var(--line,#344650)}.fisch-panel-controls p,.fisch-panel-controls pre{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.fisch-panel-controls fieldset{min-width:0;margin:6px 0}.fisch-panel-controls label{display:block}.fisch-panel-controls small{display:block}.fisch-panel-controls textarea{box-sizing:border-box;width:100%;min-width:0;max-height:100px;color:inherit;background:var(--bg,#080e14)}.fisch-panel-controls button{min-height:36px;margin:4px 6px 0 0;max-width:100%;white-space:normal}.fisch-panel-controls :focus-visible{outline:2px solid var(--focus,#fff);outline-offset:2px}`);
    host.prepend(style);
    this.host = host; this.summary = summary; this.list = list; this.status = status; container.addEventListener('focusin', this.composerFocus);
  }
  private refresh() { this.summary.textContent = `Yêu cầu và công cụ${this.pending.size ? ' · ' + this.pending.size + ' chờ' : ''}`; }
  private remember(value: string) { this.settled.add(value); if (this.settled.size > 64) this.settled.delete(this.settled.values().next().value!); }
  private async send(entry: Entry, value: PanelResponse) {
    if (this.disposed || entry.sent || this.pending.get(key(entry.control)) !== entry) return;
    entry.sent = true; entry.node.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>('button,input,textarea').forEach(node => node.disabled = true);
    entry.state.textContent = 'Đang gửi lựa chọn; chưa xác nhận kết quả.';
    try { await this.respond(value); } catch {
      if (!this.disposed && this.pending.get(key(entry.control)) === entry) entry.state.textContent = 'Chưa rõ lựa chọn đã được nhận. Không gửi lại; kiểm tra kết nối.';
    }
  }
  private paintApproval(entry: Entry) {
    const control = entry.control, info = approvalInfo(control, this.tools.get(toolKey(control, control.itemId))?.value.item);
    entry.info.replaceChildren(info.host);
    entry.node.querySelectorAll('button').forEach(button => button.remove());
    for (const decision of control.choices) {
      const button = element('button', ({ accept: 'Cho phép lần này', decline: 'Không cho phép', cancel: 'Hủy' } as Data)[decision]); button.type = 'button';
      button.disabled = entry.sent || decision === 'accept' && !info.informed;
      button.onclick = () => { void this.send(entry, { id: control.id, decision: decision as 'accept' | 'decline' | 'cancel' }); }; entry.node.append(button);
    }
  }
  private questionForm(entry: Entry) {
    const form = element('form'), readAnswers: (() => [string, string])[] = [];
    for (const [index, q] of entry.control.details.questions.entries()) {
      const field = element('fieldset'), legend = element('legend', q.header), prompt = element('p', q.question), free = element('textarea');
      free.maxLength = 4000; free.rows = 2; free.setAttribute('aria-label', 'Trả lời ' + q.header);
      field.append(legend, prompt); const radios: HTMLInputElement[] = [];
      for (const [position, option] of (q.options ?? []).entries()) {
        const label = element('label'), radio = element('input'); radio.type = 'radio'; radio.name = `panel-${this.mount}-${this.serial}-${index}`; radio.value = String(position);
        label.append(radio, document.createTextNode(option.label), element('small', option.description)); field.append(label); radios.push(radio);
      }
      const other = element('input'); other.type = 'radio'; other.name = `panel-${this.mount}-${this.serial}-${index}`; other.value = 'other';
      if (q.options?.length && q.isOther) { const label = element('label'); label.append(other, document.createTextNode('Khác')); field.append(label); }
      if (!q.options?.length || q.isOther) field.append(free);
      readAnswers.push(() => [q.id, q.options?.length ? radios.find(radio => radio.checked) ? q.options[Number(radios.find(radio => radio.checked)!.value)].label : other.checked && q.isOther ? free.value.trim() : '' : free.value.trim()]);
      form.append(field);
    }
    const submit = element('button', 'Gửi câu trả lời'); submit.type = 'submit'; submit.disabled = true; form.append(submit);
    const answers = () => Object.fromEntries(readAnswers.map(read => { const [id, value] = read(); return [id, { answers: [value] }]; }));
    const valid = () => { const value = answers(); return Object.values(value).every(v => !!v.answers[0] && v.answers[0].length <= 4000) && bytes(value) <= 16384; };
    form.oninput = form.onchange = () => { submit.disabled = entry.sent || !valid(); };
    form.onsubmit = event => { event.preventDefault(); if (valid()) void this.send(entry, { id: entry.control.id, answers: answers() }); };
    entry.info.append(form);
  }
  private request(value: Control) {
    const identity = key(value), existing = this.pending.get(identity);
    if (this.settled.has(identity)) return;
    if (existing) {
      if (existing.fingerprint !== JSON.stringify(value)) { existing.sent = true; existing.state.textContent = 'Yêu cầu đã thay đổi; không gửi lại. Chờ Native kết thúc yêu cầu.'; this.paintApproval(existing); }
      return;
    }
    if (this.pending.size >= 16) { this.status.textContent = 'Đã đạt giới hạn hiển thị yêu cầu; không tự cấp quyền.'; return; }
    const card = element('article'), info = element('div'), state = element('p'); this.serial++;
    card.append(element('strong', value.method === methods[2] ? 'Native cần câu trả lời' : 'Native cần lựa chọn'), info, state); this.list.prepend(card);
    const entry = { control: value, node: card, info, state, sent: false, fingerprint: JSON.stringify(value) }; this.pending.set(identity, entry);
    value.method === methods[2] ? this.questionForm(entry) : this.paintApproval(entry); this.host.open = true; this.refresh();
  }
  private tool(value: Data) {
    const identity = toolKey(value), prior = this.tools.get(identity);
    if (prior?.value.phase === 'completed' && value.phase === 'started') return;
    const card = prior?.node ?? element('article'), item = value.item;
    card.replaceChildren(element('strong', `Công cụ: ${item.type}`), element('p', `${value.phase === 'started' ? 'Bắt đầu' : 'Kết thúc sự kiện'}${typeof item.status === 'string' ? ' · ' + item.status : ''}`));
    if (typeof item.command === 'string') card.append(element('pre', item.command));
    if (typeof item.cwd === 'string') card.append(element('pre', item.cwd));
    if (typeof item.tool === 'string') card.append(element('p', item.tool));
    if (Number.isInteger(item.exitCode)) card.append(element('p', 'Exit code: ' + item.exitCode));
    if (item.truncated) card.append(element('p', 'Native đã rút gọn dữ liệu công cụ.'));
    for (const file of changes(item) ?? []) card.append(element('p', `${file.kind.type}: ${file.path}`));
    if (!prior) this.list.append(card); this.tools.set(identity, { value, node: card });
    while (this.tools.size > 24) { const first = this.tools.keys().next().value!; this.tools.get(first)!.node.remove(); this.tools.delete(first); }
    for (const entry of this.pending.values()) if (entry.control.method === methods[1] && toolKey(entry.control, entry.control.itemId) === identity) this.paintApproval(entry);
  }
  project(value: unknown) {
    if (this.disposed) return; const dto = parsePanelControl(value);
    if (!dto) { this.status.textContent = 'Dữ liệu điều khiển không hợp lệ; chưa gửi phản hồi.'; this.host.open = true; return; }
    if (dto.type === 'request') this.request(dto as Control);
    if (dto.type === 'tool') this.tool(dto);
    if (dto.type === 'unsupported') { this.status.textContent = 'Panel không xử lý yêu cầu Native này; không tự cấp quyền.'; this.host.open = true; }
    if (dto.type === 'resolved') { const identity = key(dto); this.pending.get(identity)?.node.remove(); this.pending.delete(identity); this.remember(identity); this.status.textContent = reasons[dto.reason]; if (!this.pending.size && dto.reason !== 'response_unknown') this.host.open = false; this.refresh(); }
  }
  clear() { for (const identity of this.pending.keys()) this.remember(identity); this.pending.clear(); this.tools.clear(); this.list.replaceChildren(); this.status.textContent = ''; this.host.open = false; this.refresh(); }
  dispose() { if (this.disposed) return; this.clear(); this.disposed = true; this.container.removeEventListener('focusin', this.composerFocus); this.host.remove(); }
}
export function mountPanelControls(container: HTMLElement, respond: (value: PanelResponse) => Promise<unknown>) {
  const panel = new PanelControls(container, respond);
  return { project: (value: unknown) => panel.project(value), clear: () => panel.clear(), dispose: () => panel.dispose() };
}
