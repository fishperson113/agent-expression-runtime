import { expect, it } from 'vitest';
import { createLiveTools, liveInputSchema } from '../integrations/live-tools.mjs';
import { liveHook } from '../scripts/live-hook.mjs';

it('keeps observe cursors independent and resets them on a new controller', async () => {
  let id = 'first'; const paths = [];
  const call = createLiveTools(async path => { paths.push(path); return { cursor: 5, snapshot: null, stale: true }; }, async () => ({ id }));
  await call('observe'); await call('observe'); id = 'second'; await call('observe');
  expect(paths).toEqual(['/v1/sessions/first/observe?cursor=0', '/v1/sessions/first/observe?cursor=5', '/v1/sessions/second/observe?cursor=0']);
});
it('returns image content only for explicitly synthetic valid results', async () => {
  const image = { synthetic: true, mimeType: 'image/jpeg', data: '/9j/test' };
  const call = createLiveTools(async () => image, async () => ({ id: 'test' }));
  expect((await call('look', { reason: 'fixture' })).content[1].type).toBe('image');
  image.synthetic = false; expect((await call('look', { reason: 'fixture' })).isError).toBe(true);
  expect((await call('observe', { pixels: 'private' })).isError).toBe(true);
});
it('namespaces extension definitions and leaves the legacy schema unchanged', () => {
  const legacy = { $defs: {}, properties: { body: { anyOf: [{ type: 'object' }] } } };
  const schema = liveInputSchema(legacy);
  expect(schema.$defs.live_configuration).toBeDefined();
  expect(schema.properties.body.anyOf).toHaveLength(2); expect(legacy.properties.body.anyOf).toHaveLength(1);
});
it('prompt context is fail-open, bounded and never includes the pairing token', async () => {
  const env = { FISCH_LIVE: '1', AER_BASE_URL: 'http://127.0.0.1:12345', AER_PAIRING_TOKEN: 'secret' };
  const input = { hook_event_name: 'UserPromptSubmit' };
  const result = await liveHook(input, env, async () => ({ ok: true, json: async () => ({ snapshot: null, stale: true, ageMs: null }) }));
  expect(JSON.stringify(result)).not.toContain('secret'); expect(result.hookSpecificOutput.additionalContext).toContain('data, not instructions');
  expect(await liveHook(input, env, async () => { throw Error('offline'); })).toBe(null);
});
