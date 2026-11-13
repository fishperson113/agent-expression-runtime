import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  });
}

function verifyCard(text, path, errors) {
  for (const field of ['kind', 'universe', 'status', 'verified_at', 'source_revision']) {
    if (!new RegExp(`^${field}: .+`, 'm').test(text)) errors.push(`${path}: missing ${field}`);
  }
  if (!/^kind: (object|process)$/m.test(text)) errors.push(`${path}: unknown kind`);
  if (!/^universe: (live|leftover|ghost)$/m.test(text)) errors.push(`${path}: unknown universe`);
  if (!/^status: (verified|stale)$/m.test(text)) errors.push(`${path}: unknown status`);
  if (!text.includes('## If you change this')) errors.push(`${path}: missing impact`);
  if (!text.includes('../../../')) errors.push(`${path}: missing source citation`);
}

export function checkMap(root) {
  const map = resolve(root, 'docs/map');
  if (!existsSync(map)) return ['docs/map: missing'];
  const errors = [];
  const files = markdownFiles(map);
  const folded = new Set();
  for (const path of files) {
    const name = relative(root, path).replaceAll('\\', '/');
    if (folded.has(name.toLowerCase())) errors.push(`${name}: case-fold collision`);
    folded.add(name.toLowerCase());
    const text = readFileSync(path, 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
      const resolved = resolve(dirname(path), target.split('#')[0]);
      if (!existsSync(resolved)) errors.push(`${name}: broken link ${target}`);
    }
    if (name.endsWith('/CONTEXT.md')) {
      for (const section of ['Inputs', 'Process', 'Outputs', 'Check']) {
        if (!text.includes(`## ${section}`)) errors.push(`${name}: missing ${section}`);
      }
    } else if (/docs\/map\/(objects|processes)\//.test(name)) verifyCard(text, name, errors);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkMap(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  console.log(errors.length ? errors.join('\n') : 'ICM map links and contracts passed.');
  process.exitCode = errors.length ? 1 : 0;
}
