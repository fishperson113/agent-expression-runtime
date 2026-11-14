import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const source = readFileSync(new URL('../src/live/main.ts', import.meta.url), 'utf8');
it('does not expose a camera-observer chat publication call site', () => {
  expect(source).not.toMatch(/conversation\.reaction\s*\(/);
  expect(source).toContain('const chatPublished = false;');
});
it('retains camera observation, visual admission, and canonical native chat projection', () => {
  expect(source).toContain('body.admitReactive(compiled, owner);');
  expect(source).toContain('await reactive.deliver(id, data?.decision ?? null)');
  expect(source).toContain('chatCameraFrame: async () =>');
  expect(source).toContain('conversation.project(value)');
});
