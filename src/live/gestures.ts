export type HandCategory = { categoryName: string; score: number };
const names: Record<string, string> = { Open_Palm: 'Xòe tay', Closed_Fist: 'Nắm tay', Pointing_Up: 'Chỉ lên',
  Thumb_Up: 'Giơ ngón cái', Thumb_Down: 'Úp ngón cái', Victory: 'Chữ V', ILoveYou: 'I love you' };
export class HandGestures {
  private candidate = '';
  private since = 0;
  private lastAt = -Infinity;
  private confirmed = '';
  update(categories: HandCategory[], now: number) {
    const name = categories.slice(0, 2).find(item => Number.isFinite(item.score) && item.score >= 0.75 && Object.hasOwn(names, item.categoryName))?.categoryName ?? '';
    if (name !== this.candidate || now - this.lastAt > 500) { this.candidate = name; this.since = now; this.confirmed = ''; }
    this.lastAt = now;
    if (name && now - this.since >= 250) this.confirmed = name;
    return this.label(now);
  }
  label(now: number) { return now - this.lastAt <= 500 ? names[this.confirmed] ?? null : null; }
  reset() { this.candidate = ''; this.confirmed = ''; this.lastAt = -Infinity; }
}
