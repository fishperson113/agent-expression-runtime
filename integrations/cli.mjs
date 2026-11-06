#!/usr/bin/env node
// Text-only control surface, suitable for any terminal multiplexer.
import { randomUUID } from 'node:crypto';
const base = process.env.AER_BASE_URL,
  token = process.env.AER_PAIRING_TOKEN;
if (!base || !token) {
  console.error('Set AER_BASE_URL and AER_PAIRING_TOKEN in the host environment.');
  process.exit(1);
}
const url = new URL(base);
if (
  url.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
) {
  console.error('loopback_url_required');
  process.exit(1);
}
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(2000),
  });
  if (response.status === 204) return { status: 'closed' };
  let value;
  try {
    value = await response.json();
  } catch {
    throw Error(`http_${response.status}`);
  }
  if (!response.ok) throw Error(value.code ?? `http_${response.status}`);
  return value;
}
const command = process.argv[2] ?? 'capabilities';
try {
  if (command === 'capabilities')
    console.log(JSON.stringify(await request('/v1/capabilities'), null, 2));
  else if (command === 'smoke') {
    const session = await request('/v1/sessions', {});
    try {
      const start = performance.now();
      const receipt = await request(`/v1/sessions/${session.id}/expressions`, {
        epoch: session.epoch,
        requestId: randomUUID(),
        body: { type: 'morph', target: 'sphere', durationMs: 1000 },
      });
      console.log(
        JSON.stringify({
          check: 'admission',
          status: receipt.status,
          code: receipt.code ?? null,
          elapsedMs: Math.round(performance.now() - start),
          animationDurationMs: 1000,
        }),
      );
      const cancelled = await request(`/v1/sessions/${session.id}/cancel`, {
        epoch: session.epoch,
      });
      console.log(JSON.stringify({ check: 'cancel', status: cancelled.status }));
    } finally {
      console.log(JSON.stringify(await request(`/v1/sessions/${session.id}`, undefined, 'DELETE')));
    }
  } else throw Error('Usage: node integrations/cli.mjs [capabilities|smoke]');
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', code: error.message }));
  process.exitCode = 1;
}
