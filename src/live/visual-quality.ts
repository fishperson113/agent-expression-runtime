export const qualityKey = 'fisch.visual-quality';
export type VisualQuality = 2000 | 8000;
export function readVisualQuality(read = () => localStorage.getItem(qualityKey)): VisualQuality {
  try { return read() === '8000' ? 8000 : 2000; } catch { return 2000; }
}
export function saveVisualQuality(value: string, write = (v: string) => localStorage.setItem(qualityKey, v)) {
  if (!['2000', '8000'].includes(value)) return false;
  try { write(value); return true; } catch { return false; }
}
export function mountVisualQuality(current: VisualQuality) {
  const select = document.querySelector<HTMLSelectElement>('#visual-quality')!;
  const note = document.querySelector<HTMLElement>('#visual-quality-note')!;
  let saved = String(current);
  select.value = saved;
  note.textContent = `Đang dùng ${current.toLocaleString('vi-VN')} hạt. Mức cao dùng thêm tài nguyên GPU.`;
  select.addEventListener('change', () => {
    if (!saveVisualQuality(select.value)) {
      select.value = saved;
      note.textContent = 'Không lưu được tùy chọn trong trình duyệt này. Phiên hiện tại không đổi.';
      return;
    }
    saved = select.value;
    note.textContent = `Đã lưu cho lần mở trang kế tiếp. Hiện vẫn dùng ${current.toLocaleString('vi-VN')} hạt; không tự tải lại hay ngắt hội thoại.`;
  });
}
