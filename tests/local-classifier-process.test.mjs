import { afterEach, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalClassifier } from '../integrations/local-classifier-process.mjs';

const clients = [];
const python = execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
const create = extra => {
  const client = createLocalClassifier({ pythonExecutable: python,
    workerPath: fileURLToPath(new URL('./fixtures/local-classifier-worker.py', import.meta.url)),
    modelDir: join(tmpdir(), 'model'), promptPath: join(tmpdir(), 'prompt'), expectedModelId: 'fixture/local', expectedRevision: 'revision1',
    startupTimeoutMs: 5000, requestTimeoutMs: 3000, projectWindow: value => value, ...extra });
  clients.push(client); return client;
};
afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.close())); vi.unstubAllEnvs(); });

it('runs a real owned Python process with a whitelisted environment and strict five-score output', async () => {
  vi.stubEnv('FISCH_REACTIVE_API_KEY', 'PRIVATE'); vi.stubEnv('OPENAI_API_KEY', 'PRIVATE'); vi.stubEnv('PYTHONPATH', '/private');
  const client = create(); await expect(client.classify({})).rejects.toThrow('local_classifier_not_ready');
  expect(await client.ready).toEqual({ modelId: 'fixture/local', modelRevision: 'revision1' });
  expect(JSON.parse(await client.classify({ mode: 'environment' }))).toMatchObject({ schemaVersion: 1, label: 'observe' });
  await client.close(); await expect(client.classify({})).rejects.toThrow('local_classifier_closed');
});
it('retains the actual transport slot after caller abort until its matching worker reply', async () => {
  const client = create(), abort = new AbortController(); await client.ready;
  const pending = client.classify({ delay: 0.2 }, abort.signal); abort.abort();
  await expect(pending).rejects.toThrow('local_classifier_aborted'); expect(client.busy).toBe(true);
  await expect(client.classify({})).rejects.toThrow('local_classifier_busy');
  await vi.waitFor(() => expect(client.busy).toBe(false));
  await expect(client.classify({})).resolves.toContain('observe');
});
it('kills only its owned worker on timeout and never silently restarts or accepts late output', async () => {
  const client = create({ requestTimeoutMs: 80 }); await client.ready;
  await expect(client.classify({ mode: 'hang' })).rejects.toThrow('local_classifier_request_timeout');
  await client.close(); expect(client.busy).toBe(false);
  await expect(client.classify({})).rejects.toThrow('local_classifier_closed');
});
it('bounds unframed stdout and rejects malformed, unknown-id and invalid-score replies', async () => {
  for (const mode of ['oversize', 'wrong-id', 'invalid', 'exit']) {
    const client = create(); await client.ready;
    await expect(client.classify({ mode })).rejects.toThrow('local_classifier_'); await client.close();
    await expect(client.classify({})).rejects.toThrow('local_classifier_closed');
  }
});
it('rejects startup identity mismatch and startup timeout without leaving child processes', async () => {
  for (const [name, code] of [['bad-ready', 'local_classifier_protocol'], ['bad-load', 'local_classifier_protocol'], ['startup-hang', 'local_classifier_startup_timeout']]) {
    const client = create({ modelDir: join(tmpdir(), name), startupTimeoutMs: name === 'startup-hang' ? 100 : 5000 });
    await expect(client.ready).rejects.toThrow(code); await client.close();
  }
});
it('does not write a packet when cancellation wins during listener registration', async () => {
  const client = create(); await client.ready;
  const signal = { aborted: false, addEventListener(_name, callback) { this.aborted = true; callback(); }, removeEventListener() {} };
  await expect(client.classify({ mode: 'hang' }, signal)).rejects.toThrow('local_classifier_aborted');
  expect(client.busy).toBe(false); await expect(client.classify({})).resolves.toContain('observe');
});
it('rejects oversized/non-JSON/async inputs before transport and hides worker errors', async () => {
  const client = create(); await client.ready;
  for (const value of [{ text: 'x'.repeat(17000) }, { n: NaN }, { n: undefined }])
    await expect(client.classify(value)).rejects.toThrow('local_classifier_input');
  expect(client.busy).toBe(false);
  await expect(client.classify({ mode: 'error' })).rejects.toThrow('local_classifier_worker_error');
  await expect(client.classify({})).resolves.toContain('observe');
  const projected = create({ projectWindow: async () => ({}) }); await projected.ready;
  await expect(projected.classify({})).rejects.toThrow('local_classifier_input');
  const rejected = create({ projectWindow: async () => { throw Error('private'); } }); await rejected.ready;
  await expect(rejected.classify({})).rejects.toThrow('local_classifier_input');
});
