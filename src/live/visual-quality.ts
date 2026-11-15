export const qualityKey = 'fisch.visual-quality';
export type VisualQuality = 2000 | 8000;
export function readVisualQuality(read = () => localStorage.getItem(qualityKey)): VisualQuality {
  try { return read() === '8000' ? 8000 : 2000; } catch { return 2000; }
}
export function saveVisualQuality(value: string, write = (v: string) => localStorage.setItem(qualityKey, v)) {
  if (!['2000', '8000'].includes(value)) return false;
  try { write(value); return true; } catch { return false; }
}
export async function persistVisualQuality(value: string, host?: (value: number) => Promise<boolean>) {
  if (!['2000', '8000'].includes(value)) return false;
  if (!host) return saveVisualQuality(value);
  try { if (await host(Number(value)) !== true) return false; saveVisualQuality(value); return true; }
  catch { return false; }
}
export function mountVisualQuality(current: VisualQuality) {
  const select = document.querySelector<HTMLSelectElement>('#visual-quality')!;
  const note = document.querySelector<HTMLElement>('#visual-quality-note')!;
  let saved = String(current);
  select.value = saved;
  note.textContent = `Đang dùng ${current.toLocaleString('vi-VN')} hạt. Mức cao dùng thêm tài nguyên GPU.`;
  const host = (window as any).fischSaveVisualQuality;
  select.addEventListener('change', async () => {
    select.disabled = true;
    const stored = await persistVisualQuality(select.value, typeof host === 'function' ? host : undefined);
    select.disabled = false;
    if (!stored) {
      select.value = saved;
      note.textContent = 'Không lưu được tùy chọn trong trình duyệt này. Phiên hiện tại không đổi.';
      return;
    }
    saved = select.value;
    note.textContent = `${typeof host === 'function' ? 'Đã lưu cho lần chạy Fisch kế tiếp.' : 'Đã lưu cho lần mở lại cùng địa chỉ trình duyệt.'} Hiện vẫn dùng ${current.toLocaleString('vi-VN')} hạt; không tự tải lại hay ngắt hội thoại.`;
  });
}
