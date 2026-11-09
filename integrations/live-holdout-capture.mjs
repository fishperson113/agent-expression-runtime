import { resolve } from 'node:path';

export function holdoutCapture(page, directory, stem) {
  const pending = [], frames = [];
  let attempted = 0, failed = 0;
  const capture = item => {
    if (item.server !== 'fisch_live' || !['express', 'return_to_face'].includes(item.tool) || attempted >= 4) return;
    const name = `${stem}-active-${++attempted}.png`;
    pending.push(page.waitForTimeout(150).then(async () => {
      await page.locator('#body').screenshot({ path: resolve(directory, name) });
      frames.push(name);
    }).catch(() => { failed++; }));
  };
  const finish = async () => {
    await Promise.all(pending);
    return { frames, failed, limit: 4, timing: '150ms after tool completion; not animation completion or human recognition' };
  };
  return { capture, finish };
}
