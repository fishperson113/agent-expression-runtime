import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
let errors = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.ts')) {
      const code = readFileSync(file, 'utf8');
      if (
        /(?:from\s*['"](?:three|@tauri|.*adapters|.*app|.*workers)|\b(?:document|window|Worker|OffscreenCanvas)\b)/.test(
          code,
        )
      )
        errors.push(file);
    }
  }
}
walk('src/core');
if (errors.length) {
  console.error('Forbidden core dependency:', errors);
  process.exit(1);
}
console.log('Core dependency boundaries passed.');
