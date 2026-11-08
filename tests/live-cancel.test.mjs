import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { openLive } from '../integrations/live-launch.mjs';
import { gatewayExecutable } from '../scripts/start-session.mjs';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';

it.skipIf(!existsSync(gatewayExecutable()))('revokes browser-cancelled work without replay, then accepts a new explicit request', async () => {
  const live = await openLive({ headless: true }); let client;
  try {
    client = liveTestClient(live.base, live.token); await client.call('initialize');
    const first = toolValue(await client.tool('express', { body: { type: 'morph', target: 'wall', durationMs: 8000 } }));
    expect(first.status).toBe('accepted');
    await live.page.locator('#cancel').click();
    await live.page.waitForTimeout(300);
    const stale = await client.tool('express', { body: { type: 'morph', target: 'pyramid', durationMs: 100 } });
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toContain('live_session_changed_request_not_replayed');
    const restored = toolValue(await client.tool('return_to_face'));
    expect(restored.status).toBe('accepted');
    await live.page.waitForFunction(() => window.fischLive.metrics().scene === 'face');
    const scene = await live.page.evaluate(() => window.fischLive.metrics());
    expect(scene.diagnostics.events.some(event => event.seq === first.seq && event.phase === 'cancelled')).toBe(true);
  } finally { await client?.close(); await live.close(); }
}, 45000);
