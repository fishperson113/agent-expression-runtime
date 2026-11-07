const dots = [[0, 0, 1], [0, 1, 2], [0, 2, 4], [1, 0, 8], [1, 1, 16], [1, 2, 32], [0, 3, 64], [1, 3, 128]];
function brightestPixel(pixels, width, height, dotX, dotY, dotWidth, dotHeight) {
  const left = Math.min(width - 1, Math.floor(dotX * width / dotWidth));
  const top = Math.min(height - 1, Math.floor(dotY * height / dotHeight));
  const right = Math.min(width, Math.max(left + 1, Math.floor((dotX + 1) * width / dotWidth)));
  const bottom = Math.min(height, Math.max(top + 1, Math.floor((dotY + 1) * height / dotHeight)));
  let best = -1, peak = 35;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const offset = (y * width + x) * 3;
    const value = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    if (value > peak) { best = offset; peak = value; }
  }
  return best;
}
function brailleCell(pixels, width, height, columns, rows, col, row) {
  let mask = 0, count = 0; const rgb = [0, 0, 0];
  for (const [dx, dy, bit] of dots) {
    const offset = brightestPixel(pixels, width, height, col * 2 + dx, row * 4 + dy, columns * 2, rows * 4);
    if (offset < 0) continue;
    mask |= bit; count++;
    for (let channel = 0; channel < 3; channel++) rgb[channel] += pixels[offset + channel];
  }
  return { mask, color: rgb.map(value => Math.min(255, Math.round(value / (count || 1) / 16) * 16)).join(';') };
}
export function brailleFrame(pixels, width, height, columns, rows, colored = false) {
  const lines = [];
  let foreground = '';
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < columns; col++) {
      const { mask, color } = brailleCell(pixels, width, height, columns, rows, col, row);
      if (colored && mask && color !== foreground) { line += `\x1b[38;2;${color}m`; foreground = color; }
      line += String.fromCharCode(mask ? 0x2800 + mask : 32);
    }
    lines.push(line);
  }
  return lines.join('\x1b[K\n');
}
export function displaySize(snapshot, paneId) {
  const rectangle = snapshot.layouts.flatMap(layout => layout.panes).find(pane => pane.pane_id === paneId)?.rect;
  const columns = Math.max(12, Math.min(150, (rectangle?.width ?? 80) - 4));
  const rows = Math.max(8, Math.min(60, (rectangle?.height ?? 40) - 7));
  const width = columns * 4, height = rows * 8;
  const scale = Math.min(1, 512 / width, 384 / height);
  return { columns, rows, width: Math.round(width * scale), height: Math.round(height * scale) };
}
export async function drawFrame({ pixels, size, mode, paneId, call, output = process.stdout, title }) {
  output.write(`\x1b[H\x1b[2K${title}\n\x1b[2K${mode === 'pixels' ? 'Inline particles' : 'Terminal particles (Braille)'} · q to quit\n`);
  if (mode === 'pixels') await call('pane.graphics.set', { pane_id: paneId, format: 'rgb',
    image_width: size.width, image_height: size.height, data_base64: pixels.toString('base64'),
    placement: { viewport_col: 1, viewport_row: 3, grid_cols: size.columns, grid_rows: size.rows } });
  else output.write(brailleFrame(pixels, size.width, size.height, size.columns, size.rows, true) + '\x1b[0m\x1b[J');
}
