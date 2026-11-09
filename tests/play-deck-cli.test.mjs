import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/guided-play.mjs', import.meta.url));
it('saves partial structured outcomes on EOF without persisting arbitrary user text', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fisch-play-cli-'));
  try {
    const result = spawnSync(process.execPath, [script, '--interactive', '--minutes=10'],
      { cwd, input: 'n\nprivate words that must disappear\nfailed\nrate 5 2\n', encoding: 'utf8', timeout: 5000 });
    expect(result.status).toBe(0);
    const text = readFileSync(join(cwd, '.runtime/guided-play-session.json'), 'utf8');
    const report = JSON.parse(text);
    expect(report.reason).toBe('aborted');
    expect(report.outcomes).toEqual([expect.objectContaining({ id: 'create', outcome: 'failed' })]);
    expect(report.ratings).toEqual({ enjoyment: 5, control: 2 });
    expect(report.elapsedMs).toBeLessThan(5000);
    expect(text + result.stdout).not.toContain('private words');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

it('prints a plan without recording participation and rejects invalid launch arguments', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'fisch-play-plan-'));
  try {
    const result = spawnSync(process.execPath, [script, '--plan'], { cwd, encoding: 'utf8', timeout: 5000 });
    expect(result.status).toBe(0); expect(result.stdout).toContain('GUIDED QA');
    expect(existsSync(join(cwd, '.runtime'))).toBe(false);
    const invalid = spawnSync(process.execPath, [script, '--interactive', '--minutes=9'], { cwd, timeout: 5000 });
    expect(invalid.status).not.toBe(0); expect(existsSync(join(cwd, '.runtime'))).toBe(false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
