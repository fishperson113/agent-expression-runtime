import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { checkMap } from '../scripts/check-icm.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'fisch-map-'));
  roots.push(root);
  mkdirSync(resolve(root, 'docs/map/objects'), { recursive: true });
  return root;
}
it('keeps the actual map links and contracts valid', () => expect(checkMap(process.cwd())).toEqual([]));
it('reports missing map and broken links', () => {
  expect(checkMap(resolve(tmpdir(), 'not-a-fisch-map'))).toContain('docs/map: missing');
  const root = fixture();
  writeFileSync(resolve(root, 'docs/map/AGENTS.md'), '[bad](absent.md)');
  expect(checkMap(root).join()).toContain('broken link absent.md');
});
it('rejects incomplete contracts and unverified cards', () => {
  const root = fixture();
  writeFileSync(resolve(root, 'docs/map/objects/CONTEXT.md'), '# Objects');
  writeFileSync(resolve(root, 'docs/map/objects/item.md'), '# Item');
  const errors = checkMap(root).join();
  expect(errors).toContain('missing Inputs');
  expect(errors).toContain('missing source_revision');
  expect(errors).toContain('missing source citation');
});
