type Projection = { status: 'unknown' | 'working' | 'stored' | 'empty' | 'uncertain' | 'recovered' | 'interrupted'; revision?: number; scenes?: number; recoveryRequired?: boolean; operation?: Action };
type Action = 'create' | 'remix' | 'undo' | 'reset' | 'recover';
const states = ['unknown', 'working', 'stored', 'empty', 'uncertain', 'recovered', 'interrupted'];
let mounts = 0;
const css = `.fisch-playground{min-width:0;margin:10px 0;border:1px solid var(--line,#34404a);border-radius:10px;padding:10px;background:var(--panel,#172129)}
.fisch-playground summary{cursor:pointer;font-weight:600;outline-offset:4px}.fisch-playground .pg-fields{display:grid;gap:8px;margin-top:10px;min-width:0}
.fisch-playground label{display:grid;gap:5px;font-size:13px}.fisch-playground textarea{box-sizing:border-box;width:100%;max-width:100%;min-width:0;resize:vertical;padding:8px;border:1px solid var(--line,#34404a);border-radius:6px;background:var(--bg,#111a20);color:inherit;font:inherit}
.fisch-playground .pg-actions{display:flex;flex-wrap:wrap;gap:8px}.fisch-playground button{white-space:normal;max-width:100%}
.fisch-playground p{font-size:12px;line-height:1.5;margin:7px 0;overflow-wrap:anywhere}.fisch-playground .pg-error{color:#ffd391}.fisch-playground [hidden]{display:none!important}
@media(min-width:851px){.body-panel:has(.fisch-playground) .body-stage{height:calc(100dvh - 410px)}}`;

function elements() {
  const host = document.createElement('section'), id = `fisch-playground-${++mounts}`; host.className = 'fisch-playground';
  host.innerHTML = `<details><summary aria-describedby="${id}-copy">Cùng sáng tạo</summary><div class="pg-fields">
    <p>Chép để gửi Codex. Dán vào terminal Codex đang chạy cùng Fisch; trang này không tự gửi yêu cầu.</p>
    <label for="${id}-idea">Ý tưởng<textarea id="${id}-idea" class="pg-idea" rows="2" aria-describedby="${id}-limits"></textarea></label>
    <label for="${id}-goal">Mục tiêu tùy chọn<textarea id="${id}-goal" class="pg-goal" rows="1" aria-describedby="${id}-limits"></textarea></label>
    <p id="${id}-limits">Ý tưởng tối đa 500 ký tự, mục tiêu 160 ký tự. Vui lòng nhập một dòng; nội dung chỉ nằm trong trang này cho đến khi bạn chép.</p>
    <div class="pg-actions" role="group" aria-label="Chép để gửi Codex"><button type="button" data-action="create">Nguyên tác</button><button type="button" data-action="remix">Chỉnh ý tưởng</button><button type="button" data-action="undo">Hoàn tác</button><button type="button" data-action="reset">Về bản đầu</button><button type="button" data-action="recover">Phục hồi</button></div>
    <p class="pg-error" role="alert"></p><textarea class="pg-output" aria-label="Yêu cầu chưa gửi tới Codex" rows="5" readonly hidden></textarea>
    </div></details><p class="pg-status" role="status" aria-live="polite" aria-atomic="true"></p><p id="${id}-copy" class="pg-copy-state">Chép để gửi Codex · chưa gửi.</p>`;
  const style = document.createElement('style'); style.textContent = css; host.prepend(style);
  const get = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  return { host, details: get<HTMLDetailsElement>('details'), summary: get<HTMLElement>('summary'), idea: get<HTMLTextAreaElement>('.pg-idea'),
    goal: get<HTMLTextAreaElement>('.pg-goal'), output: get<HTMLTextAreaElement>('.pg-output'), error: get<HTMLElement>('.pg-error'),
    status: get<HTMLElement>('.pg-status'), copied: get<HTMLElement>('.pg-copy-state') };
}

function projection(value: unknown): Projection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'unknown' };
  const dto = value as Record<string, unknown>;
  if (Object.keys(dto).some(key => !['status', 'revision', 'scenes', 'recoveryRequired', 'operation'].includes(key)) || !states.includes(dto.status as string) ||
      (dto.revision !== undefined && (!Number.isSafeInteger(dto.revision) || (dto.revision as number) < 0)) ||
      (dto.scenes !== undefined && (!Number.isInteger(dto.scenes) || (dto.scenes as number) < 0 || (dto.scenes as number) > 12)) ||
      (dto.recoveryRequired !== undefined && typeof dto.recoveryRequired !== 'boolean') ||
      (dto.operation !== undefined && !['create', 'remix', 'undo', 'reset', 'recover'].includes(dto.operation as string))) return { status: 'unknown' };
  return dto as Projection;
}

function statusText(dto: Projection) {
  const messages: Record<Projection['status'], string> = {
    unknown: 'Chưa xác nhận bản đã lưu trong phiên.', working: 'Codex đang xử lý; chưa xác nhận bản đã lưu mới.',
    stored: 'Lịch sử tạo hình đã được xác nhận trong phiên.', empty: 'Chưa có bản đã lưu trong phiên.',
    uncertain: 'Yêu cầu mới chưa chắc đã hoàn tất. Hãy nhờ Codex kiểm tra hoặc phục hồi.',
    recovered: 'Đã phục hồi và xóa lịch sử tạo hình; chưa có bản đã lưu mới.', interrupted: 'Đã ngắt yêu cầu; chưa xác nhận bản đã lưu mới.'
  };
  return messages[dto.status] + (dto.status !== 'unknown' && dto.scenes !== undefined ? ` Lịch sử: ${dto.scenes} bản đã lưu.` : '') +
    (dto.status !== 'unknown' && dto.revision !== undefined ? ` Lần cập nhật ${dto.revision}.` : '') + (dto.recoveryRequired ? ' Cần phục hồi; thao tác này xóa lịch sử tạo hình.' : '');
}

function request(action: Action, idea: string, goal: string) {
  if (action === 'create' || action === 'remix') {
    if (!idea.trim()) throw Error('Hãy nhập ý tưởng trước khi chép.');
    if (idea.length > 500) throw Error('Ý tưởng vượt quá 500 ký tự; hãy tự rút gọn rồi chép lại.');
    if (goal.length > 160) throw Error('Mục tiêu vượt quá 160 ký tự; hãy tự rút gọn rồi chép lại.');
    if (/[\x00-\x1f\x7f]/.test(idea + goal)) throw Error('Vui lòng nhập một dòng, không dùng ký tự điều khiển.');
    return `Tôi muốn ${action === 'create' ? 'cùng tạo một nguyên tác hạt' : 'chỉnh ý tưởng đã lưu'} trong Fisch.\nÝ tưởng do tôi nhập:\n${idea}\n` +
      (goal.trim() ? `Mục tiêu tùy chọn do tôi nhập:\n${goal}\n` : '') +
      `Hãy đọc playground_state để lấy lần cập nhật hiện tại${action === 'remix' ? ' và bản tạo hình đã lưu (includeScene=true)' : ''}, hỏi lại nếu cần, rồi tự sáng tác hình học tự do và dùng playground_edit với operation ${action} phù hợp. Không tra bảng từ khóa thành hình. Không tự bật camera hay voice.`;
  }
  const intent = { undo: 'Tôi muốn hoàn tác về bản đã lưu ngay trước đó.', reset: 'Tôi muốn về bản đầu và bỏ các bản chỉnh sửa sau đó.',
    recover: 'Tôi chủ động yêu cầu phục hồi playground và xóa lịch sử tạo hình trong phiên. Thu hồi phiên cũ; không tự phát lại hình cũ.' };
  return `${intent[action]} Hãy đọc playground_state để lấy lần cập nhật hiện tại, rồi dùng playground_edit với operation ${action}. Không tự bật camera hay voice.`;
}

export function mountPlayground(container: HTMLElement) {
  const ui = elements(); container.append(ui.host); let disposed = false, generation = 0;
  const project = (dto: unknown) => { if (!disposed) { const text = statusText(projection(dto)); if (ui.status.textContent !== text) ui.status.textContent = text; } };
  async function copy(action: Action) {
    const attempt = ++generation; ui.error.textContent = ''; ui.output.value = ''; ui.output.hidden = true;
    let text: string;
    try { text = request(action, ui.idea.value, ui.goal.value); }
    catch (error) { ui.error.textContent = (error as Error).message; return; }
    try {
      await navigator.clipboard.writeText(text); if (disposed || generation !== attempt) return;
      ui.copied.textContent = 'Đã chép; chưa gửi. Bạn tự dán vào terminal Codex khi muốn.'; ui.details.open = false; ui.summary.focus();
    } catch {
      if (disposed || generation !== attempt) return;
      ui.copied.textContent = 'Chưa chép được; chưa gửi. Chọn nội dung bên dưới để chép rồi tự gửi Codex.';
      ui.output.value = text; ui.output.hidden = false; ui.details.open = true; ui.output.focus(); ui.output.select();
    }
  }
  ui.host.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(button => { button.onclick = () => { void copy(button.dataset.action as Action); }; });
  project({ status: 'unknown' });
  return { project, clear: () => {
    if (disposed) return; generation++; ui.idea.value = ''; ui.goal.value = ''; ui.output.value = ''; ui.output.hidden = true;
    ui.error.textContent = ''; ui.copied.textContent = 'Chép để gửi Codex · chưa gửi.'; ui.details.open = false; project({ status: 'unknown' });
  }, dispose: () => {
    if (disposed) return; disposed = true; generation++;
    ui.idea.value = ''; ui.goal.value = ''; ui.output.value = '';
    ui.host.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.onclick = null; }); ui.host.remove();
  } };
}
