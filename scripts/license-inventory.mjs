import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const npm = Object.keys(root.dependencies).map((name) => {
  const p = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'));
  return `| npm | ${name} | ${p.version} | ${p.license ?? 'Check package'} |`;
});
const cargo = JSON.parse(
  execFileSync(
    'cargo',
    ['metadata', '--locked', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  ),
);
const rust = cargo.packages
  .filter((p) => p.source)
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(
    (p) =>
      `| crates.io | ${p.name} | ${p.version} | ${(p.license ?? 'Check package').replaceAll('|', '\\|')} |`,
  );
writeFileSync(
  'docs/dependency-licenses.md',
  `# Dependency license metadata\n\nGenerated from installed package manifests and locked Cargo metadata. Product code is covered by the root MIT LICENSE. Third-party components retain their own licenses. This inventory is metadata, not a substitute for the actual upstream license texts or a completed distribution review. The app icon was drawn for this project; no external font or image asset is bundled.\n\n| Ecosystem | Package | Version | Declared license |\n|---|---|---|---|\n${[...npm, ...rust].join('\n')}\n`,
);
