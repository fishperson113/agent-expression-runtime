const dots = [[0, 0, 1], [0, 1, 2], [0, 2, 4], [1, 0, 8], [1, 1, 16], [1, 2, 32], [0, 3, 64], [1, 3, 128]];
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export class BrailleRenderer {
  constructor({ gamma = 1.5, hysteresis = 0.10, exposureMs = 450, detailMix = 0.25, style = 'adaptive' } = {}) {
    Object.assign(this, { gamma, hysteresis, exposureMs, detailMix, style });
  }
  resize(width, height, columns, rows) {
    const key = `${width}:${height}:${columns}:${rows}`;
    if (key === this.key) return false;
    this.key = key; this.columns = columns; this.rows = rows;
    this.dotWidth = columns * 2; this.dotHeight = rows * 4;
    const length = this.dotWidth * this.dotHeight;
    this.density = new Float32Array(length); this.colors = new Uint8Array(length * 3);
    this.ink = new Uint8Array(length); this.histogram = new Uint32Array(256);
    this.cellColors = new Float32Array(columns * rows * 3); this.cellMasks = new Uint8Array(columns * rows);
    this.exposure = undefined; this.previous = undefined;
    return true;
  }
  sample(pixels, width, height) {
    this.histogram.fill(0); let foreground = 0;
    for (let y = 0; y < this.dotHeight; y++) for (let x = 0; x < this.dotWidth; x++) {
      const left = Math.min(width - 1, Math.floor(x * width / this.dotWidth));
      const top = Math.min(height - 1, Math.floor(y * height / this.dotHeight));
      const right = Math.min(width, Math.max(left + 1, Math.floor((x + 1) * width / this.dotWidth)));
      const bottom = Math.min(height, Math.max(top + 1, Math.floor((y + 1) * height / this.dotHeight)));
      let sum = 0, peak = 24, best = -1;
      for (let sy = top; sy < bottom; sy++) for (let sx = left; sx < right; sx++) {
        const offset = (sy * width + sx) * 3;
        const level = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
        sum += Math.max(0, level - 20);
        if (level > peak) { peak = level; best = offset; }
      }
      const index = y * this.dotWidth + x;
      const mean = sum / ((right - left) * (bottom - top) * 235);
      const value = best < 0 ? 0 : mean * (1 - this.detailMix) + (peak - 20) / 235 * this.detailMix;
      this.density[index] = this.style === 'peak' ? Number(peak > 35) : value;
      for (let c = 0; c < 3; c++) this.colors[index * 3 + c] = best < 0 ? 0 : pixels[best + c];
      const signal = this.density[index];
      if (signal > 0) { this.histogram[Math.min(255, Math.max(1, Math.round(signal * 255)))]++; foreground++; }
    }
    return foreground;
  }
  adapt(foreground, now) {
    const reset = this.previous === undefined || now < this.previous || now - this.previous > 2000 || !this.foreground && foreground > 0;
    const dt = reset ? 0 : Math.max(0, Math.min(250, now - this.previous)); this.previous = now;
    this.colorGain = reset ? 1 : 1 - Math.exp(-dt / 120);
    let accumulated = 0, percentile = 1;
    for (let i = 1; i < 256; i++) {
      accumulated += this.histogram[i];
      if (accumulated >= foreground * 0.98) { percentile = (i - 0.5) / 255; break; }
    }
    const target = Math.max(0.035, percentile);
    if (reset || this.exposure === undefined) { this.exposure = target; this.ink.fill(0); }
    else if (foreground) this.exposure += (target - this.exposure) * (1 - Math.exp(-dt / this.exposureMs));
    for (let y = 0; y < this.dotHeight; y++) for (let x = 0; x < this.dotWidth; x++) {
      const index = y * this.dotWidth + x, density = this.density[index];
      const level = Math.pow(Math.min(1, density / this.exposure), this.gamma);
      const threshold = (bayer[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const margin = this.ink[index] ? -this.hysteresis : this.hysteresis;
      this.ink[index] = density > 0 && level >= Math.min(1, Math.max(0, threshold + margin)) ? 1 : 0;
    }
    this.foreground = foreground;
  }
  cell(col, row) {
    let mask = 0, count = 0, red = 0, green = 0, blue = 0;
    for (const [dx, dy, bit] of dots) {
      const index = (row * 4 + dy) * this.dotWidth + col * 2 + dx;
      if (!this.ink[index]) continue;
      mask |= bit; count++;
      red += this.colors[index * 3]; green += this.colors[index * 3 + 1]; blue += this.colors[index * 3 + 2];
    }
    const cell = row * this.columns + col, gain = this.cellMasks[cell] ? this.colorGain : 1;
    const color = [red, green, blue].map((value, channel) => {
      const index = cell * 3 + channel, target = value / (count || 1);
      this.cellColors[index] += (target - this.cellColors[index]) * gain;
      return Math.min(255, Math.round(this.cellColors[index] / 16) * 16);
    }).join(';');
    this.cellMasks[cell] = mask;
    return { mask, color };
  }
  render(pixels, width, height, columns, rows, colored = false, now = performance.now()) {
    this.resize(width, height, columns, rows);
    this.adapt(this.sample(pixels, width, height), now);
    const lines = []; let foreground = '';
    for (let row = 0; row < rows; row++) {
      let line = '';
      for (let col = 0; col < columns; col++) {
        const { mask, color } = this.cell(col, row);
        if (colored && mask && color !== foreground) { line += `\x1b[38;2;${color}m`; foreground = color; }
        line += String.fromCharCode(mask ? 0x2800 + mask : 32);
      }
      lines.push(line);
    }
    return lines.join('\x1b[K\n');
  }
  get info() {
    return { style: this.style, toneMapping: this.style !== 'peak', gamma: this.gamma,
      hysteresis: this.hysteresis, exposure: this.exposure, columns: this.columns, rows: this.rows,
      litDots: this.ink?.reduce((sum, value) => sum + value, 0) ?? 0 };
  }
}
