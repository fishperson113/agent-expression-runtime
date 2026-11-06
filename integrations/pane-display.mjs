const dots = [[0, 0, 1], [0, 1, 2], [0, 2, 4], [1, 0, 8], [1, 1, 16], [1, 2, 32], [0, 3, 64], [1, 3, 128]];
export function brailleFrame(pixels, width, height, columns, rows) {
  const lines = [];
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < columns; col++) {
      let mask = 0;
      for (const [dx, dy, bit] of dots) {
        const x = Math.min(width - 1, Math.floor((col * 2 + dx) * width / (columns * 2)));
        const y = Math.min(height - 1, Math.floor((row * 4 + dy) * height / (rows * 4)));
        if (pixels[(y * width + x) * 3 + 1] > 35) mask |= bit;
      }
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
  else output.write('\x1b[38;2;121;230;211m' + brailleFrame(pixels, size.width, size.height, size.columns, size.rows) + '\x1b[0m\x1b[J');
}
