import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
it('guards optional upstream orchestration with generation, cancellation and local-only boundaries', () => {
  const output = execFileSync(process.env.FISCH_OLV_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'olv_adapter_test.py'], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  expect(output).toBe('');
});
