import { BrailleRenderer } from './braille-renderer.mjs';

const renderers = new WeakMap();
function paneCaption(text, columns) {
  let result = '', width = 0;
  for (const character of text.replace(/[\p{Cc}\p{Cf}]/gu, ' ')) {
    const point = character.codePointAt(0);
    const wide = point >= 0x1100 && (point <= 0x115f || point >= 0x2e80 && point <= 0xa4cf ||
      point >= 0xac00 && point <= 0xd7a3 || point >= 0xf900 && point <= 0xfaff ||
      point >= 0xfe10 && point <= 0xfe6f || point >= 0xff00 && point <= 0xff60 || point >= 0x1f300);
    const advance = /\p{Mark}/u.test(character) ? 0 : wide ? 2 : 1;
    if (width + advance > columns) break;
    result += character; width += advance;
  }
  return result;
}
export function brailleFrame(pixels, width, height, columns, rows, colored = false) {
  return new BrailleRenderer().render(pixels, width, height, columns, rows, colored);
}
export function brailleInfo(output = process.stdout) { return renderers.get(output)?.info ?? null; }
export function displaySize(snapshot, paneId) {
  const rectangle = snapshot.layouts.flatMap(layout => layout.panes).find(pane => pane.pane_id === paneId)?.rect;
  const columns = Math.max(12, Math.min(150, (rectangle?.width ?? 80) - 4));
  const rows = Math.max(8, Math.min(60, (rectangle?.height ?? 40) - 7));
  const width = columns * 4, height = rows * 8;
  const scale = Math.min(1, 512 / width, 384 / height);
  return { columns, rows, width: Math.round(width * scale), height: Math.round(height * scale) };
}
export async function drawFrame({ pixels, size, mode, paneId, call, output = process.stdout, title, caption, reset = false }) {
  const label = caption ? paneCaption(caption, size.columns)
    : `${mode === 'pixels' ? 'Inline particles' : 'Terminal particles (Braille)'} · q to quit`;
  const header = `\x1b[H\x1b[2K${title}\n\x1b[2K${label}\n`;
  if (mode === 'pixels') {
    output.write(header);
    await call('pane.graphics.set', { pane_id: paneId, format: 'rgb',
      image_width: size.width, image_height: size.height, data_base64: pixels.toString('base64'),
      placement: { viewport_col: 1, viewport_row: 3, grid_cols: size.columns, grid_rows: size.rows } });
  }
  else {
    if (reset) renderers.delete(output);
    let renderer = renderers.get(output);
    if (!renderer) {
      renderer = new BrailleRenderer({ style: process.env.FISCH_BRAILLE_STYLE === 'peak' ? 'peak' : 'adaptive' });
      renderers.set(output, renderer);
    }
    output.write(header + renderer.render(pixels, size.width, size.height, size.columns, size.rows, true) + '\x1b[0m\x1b[J');
  }
}
