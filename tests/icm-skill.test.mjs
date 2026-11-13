import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const canonical = '.agents/skills/icm-architect/SKILL.md';
const adapter = '.claude/skills/icm-architect/SKILL.md';

function python(code) {
  const command = process.platform === 'win32' ? 'py' : 'python3';
  const args = process.platform === 'win32' ? ['-3', '-B', '-c', code] : ['-B', '-c', code];
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return result.stdout;
}

describe('ICM skill integration', () => {
  it('routes both agent discovery paths to one pinned, licensed methodology', () => {
    const skill = readFileSync(canonical, 'utf8');
    const pointer = readFileSync(adapter, 'utf8');
    expect(skill).toContain('name: icm-architect');
    expect(pointer).toContain('../../../.agents/skills/icm-architect/SKILL.md');
    expect(skill).toContain('8bc2f5610d3843b3ffa31a142effe6b6337fef3c');
    expect(readFileSync('.agents/skills/icm-architect/LICENSE', 'utf8')).toContain('Jake Van Clief');
    for (const file of [canonical, adapter, '.agents/skills/icm-architect/PROVENANCE.md']) {
      for (const [, link] of readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
        if (!link.startsWith('https:')) expect(existsSync(resolve(dirname(file), link))).toBe(true);
      }
    }
  });

  it('preserves config and hooks, is idempotent, and keeps R4 narrowly scoped', () => {
    python(`
import importlib.util, pathlib, subprocess, tempfile
root = pathlib.Path.cwd()
spec = importlib.util.spec_from_file_location('setup', root/'scripts/setup-harness.py')
setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)
with tempfile.TemporaryDirectory() as tmp:
    target = pathlib.Path(tmp)
    subprocess.run(['git','init','--quiet',tmp],check=True)
    config = target/'.git/my-harness.toml'
    config.write_text('max_files = 10\\ndocs_extra_dirs = ["custom-docs", "."]\\n')
    hooks = target/'.git/hooks/pre-commit'
    hooks.write_text('preserve existing hook')
    setup.ROOT = target
    setup.setup_repo(); first = config.read_bytes(); setup.setup_repo()
    assert config.read_bytes() == first
    assert hooks.read_text() == 'preserve existing hook'
    import harness
    cfg = harness.parse_toml(config.read_text())
    assert cfg['max_files'] == 10
    assert cfg['docs_extra_dirs'] == ['custom-docs'] + setup.REPO_DOCS_DIRS
    class Context:
        focus = ['.agents/skills/icm-architect/SKILL.md', '.claude/skills/icm-architect/SKILL.md', 'docs/map/CONTEXT.md', 'docs/map/objects/dsl.md', 'docs/map/processes/context.md', 'docs/map/effects/CONTEXT.md', 'src/new.md', '.agents/skills/unrelated/SKILL.md', 'docs/map/arbitrary/new.md']
        cfg = {'decisions_file':'decisions.md'}
        def docs(self): return set(cfg['docs_extra_dirs'])
    bad = harness.r4(Context())[2]
    assert bad == ['src/new.md', '.agents/skills/unrelated/SKILL.md', 'docs/map/arbitrary/new.md'], bad
`);
  });

  it('uses the same configuration for CI snapshots without altering global hooks', () => {
    python(`
import importlib.util, pathlib, subprocess, tempfile
root = pathlib.Path.cwd()
spec = importlib.util.spec_from_file_location('checker',root/'scripts/check-harness.py')
checker = importlib.util.module_from_spec(spec); spec.loader.exec_module(checker)
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['git','init','--quiet',tmp],check=True)
    checker.configure_snapshot(tmp)
    text = (pathlib.Path(tmp)/'.git/my-harness.toml').read_text()
    assert '.agents/skills/icm-architect' in text
    assert '.claude/skills/icm-architect' in text
    assert not (pathlib.Path(tmp)/'.codex/hooks.json').exists()
`);
  });
});
