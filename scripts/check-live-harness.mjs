import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function addedLines(file) {
  const diff = execFileSync('git', ['diff', '--cached', '--unified=0', '--', file], { encoding: 'utf8' });
  const lines = new Set(); let current = 0;
  for (const line of diff.split('\n')) {
    const match = /^@@ .* \+(\d+)/.exec(line);
    if (match) { current = Number(match[1]); continue; }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) lines.add(current++);
    else if (line.startsWith(' ')) current++;
  }
  return lines;
}

function checkFunctions(file, added) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const errors = [];
  function visit(node) {
    if (ts.isFunctionLike(node) && node.body) {
      const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const last = source.getLineAndCharacterOfPosition(node.end).line + 1;
      if (last - first + 1 > 50 && [...added].some(line => line >= first && line <= last))
        errors.push(`${file}:${first}: function has ${last - first + 1} lines`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source); return errors;
}

const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const total = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const errors = [];
if (total.length > 10) errors.push(`File budget exceeded: ${total.length}`);
for (const file of files) {
  const status = execFileSync('git', ['diff', '--cached', '--name-status', '--', file], { encoding: 'utf8' });
  if (status.startsWith('A') && /(?:_v\d+|_new|_old|_backup|\.bak)(?:\.|$)/i.test(file)) errors.push(`Copy-style filename: ${file}`);
  if (status.startsWith('A') && file.endsWith('.md') && !/^(?:docs|integrations)\//.test(file)) errors.push(`Markdown location: ${file}`);
  if (!/\.(?:[cm]?js|tsx?|rs)$/.test(file)) continue;
  const added = addedLines(file), content = readFileSync(file, 'utf8').split('\n');
  const comments = [...added].filter(line => /^\s*(?:\/\/|\/\*|\*|\*\/)/.test(content[line - 1] ?? '')).length;
  if (added.size && comments / added.size >= 0.3) errors.push(`Comment ratio: ${file}`);
  if (!file.endsWith('.rs')) errors.push(...checkFunctions(file, added));
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Harness structural checks passed for ${total.length} staged files (Rust functions require manual review).`);
