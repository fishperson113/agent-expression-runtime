import type { TransformWrite } from '../core/live/compositor';
export type HandCategory = { categoryName: string; score: number };
const names: Record<string, string> = { Open_Palm: 'Xòe tay', Closed_Fist: 'Nắm tay', Pointing_Up: 'Chỉ lên',
  Thumb_Up: 'Giơ ngón cái', Thumb_Down: 'Úp ngón cái', Victory: 'Chữ V', ILoveYou: 'I love you' };
export class HandGestures {
  private candidate = '';
  private since = 0;
  private lastAt = -Infinity;
  private at = -Infinity;
  private accepted = '';
  update(categories: HandCategory[], now: number) {
    const name = categories.slice(0, 2).find(item => Number.isFinite(item.score) && item.score >= 0.75 && Object.hasOwn(names, item.categoryName))?.categoryName ?? '';
    if (name !== this.candidate || now - this.lastAt > 500) { this.candidate = name; this.since = now; }
    this.lastAt = now;
    if (!name || now - this.since < 250 || now - this.at < 1800) return null;
    this.accepted = name; this.at = now;
    return names[name];
  }
  label(now: number) { return now - this.at < 1800 ? names[this.accepted] : null; }
  reset() { this.candidate = ''; this.accepted = ''; this.at = -Infinity; this.lastAt = -Infinity; }
  sample(now: number, mode: 'normal' | 'reduced' | 'off'): TransformWrite[] {
    const t = (now - this.at) / 1000;
    if (mode === 'off' || t < 0 || t >= 1) return [];
    const amplitude = Math.sin(t * Math.PI) ** 2 * (mode === 'reduced' ? 0.08 : 1);
    const prop = this.accepted === 'Open_Palm' || this.accepted === 'Closed_Fist' ? 'scaleX' :
      this.accepted === 'Thumb_Up' || this.accepted === 'Pointing_Up' ? 'y' : 'rotateZ';
    const value = prop === 'scaleX' ? 1 + amplitude * (this.accepted === 'Closed_Fist' ? -0.2 : 0.2) : amplitude * 0.22;
    return [{ target: { part: 'body', prop }, value }];
  }
}
