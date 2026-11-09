export const playCards = Object.freeze([
  { id: 'create', prompt: 'Cùng tôi tạo một sinh vật hoặc vật thể hạt chưa có tên. Hỏi tôi một lựa chọn rồi tự dựng hình học từ lựa chọn đó.' },
  { id: 'remix', prompt: 'Giữ ý tưởng tôi vừa tạo, đề xuất hai cách biến đổi khác nhau để tôi chọn. Chỉ thay đổi sau khi tôi chọn; không dùng preset theo từ khóa.' },
  { id: 'improv', prompt: 'Dùng hình hiện tại diễn một chuyện nhỏ ba nhịp: chuẩn bị, thử làm, hồi phục. Để tôi tự quyết định chuyện gì xảy ra.' },
  { id: 'correct', prompt: 'Để tôi đoán câu chuyện qua chuyển động, rồi sửa cách diễn theo điều tôi hiểu sai. Không chấm đúng dựa trên tên hình hay câu chữ.' },
  { id: 'interrupt', prompt: 'Cùng thử một lượt diễn để tôi ngắt giữa chừng bằng Dừng biểu đạt. Sau đó chỉ tiếp tục khi tôi yêu cầu mới; không phát lại đoạn cũ.' },
  { id: 'free', prompt: 'Tôi sẽ tự chọn việc tiếp theo. Nếu tôi im lặng, cứ để tôi yên; không gọi model vì idle và không tự bật camera hay voice.' }
].map(Object.freeze));

export class PlayDeck {
  constructor({ start, minutes = 20, seed = 9011 }) {
    if (!Number.isFinite(start)) throw Error('clock');
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 20) throw Error('duration');
    if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) throw Error('seed');
    this.start = this.lastAt = start; this.limitMs = minutes * 60000; this.seed = seed;
    this.random = seed; this.outcomes = []; this.discarded = 0; this.finished = false;
  }
  tick(now) {
    if (!Number.isFinite(now) || now < this.lastAt) throw Error('clock');
    this.lastAt = now;
    if (!this.finished && now >= this.start + this.limitMs) this.finish(this.start + this.limitMs, 'deadline', true);
  }
  next(now) {
    this.tick(now); if (this.finished) return null;
    this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0;
    let index = this.outcomes.length + this.discarded === 0 ? 0 : this.random % playCards.length;
    if (playCards[index].id === this.active?.id) index = (index + 1) % playCards.length;
    const card = playCards[index];
    this.active = { id: card.id, atMs: now - this.start, outcome: 'uncertain' };
    this.outcomes.push(this.active);
    if (this.outcomes.length > 128) { this.outcomes.shift(); this.discarded++; }
    return { ...card };
  }
  record(outcome, now) {
    if (!['completed', 'failed', 'skipped', 'uncertain'].includes(outcome)) throw Error('outcome');
    this.tick(now); if (this.finished || !this.active) throw Error('inactive');
    this.active.outcome = outcome;
  }
  rate(enjoyment, control, now) {
    if (![enjoyment, control].every(value => Number.isInteger(value) && value >= 1 && value <= 5)) throw Error('rating');
    this.tick(now); if (this.finished) throw Error('inactive');
    this.ratings = { enjoyment, control };
  }
  finish(now, reason = 'completed', deadline = false) {
    if (!['completed', 'aborted', 'deadline'].includes(reason)) throw Error('reason');
    if (!deadline) this.tick(now);
    if (!this.finished) { this.finished = true; this.endedAt = now; this.reason = reason; }
  }
  report(now) {
    this.tick(now);
    return { v: 1, guided: true, synthetic: false, seed: this.seed, limitMs: this.limitMs,
      elapsedMs: (this.endedAt ?? now) - this.start, finished: this.finished, reason: this.reason,
      discarded: this.discarded, ratings: this.ratings ? { ...this.ratings } : null,
      outcomes: this.outcomes.map(value => ({ ...value })) };
  }
}
