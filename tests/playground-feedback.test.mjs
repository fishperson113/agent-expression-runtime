import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { subscribePlaygroundFeedback } from '../integrations/playground-feedback.mjs';

const sessionId = '12345678-1234-4234-8234-123456789abc';
const epoch = '87654321-4321-4321-8321-cba987654321';
const servers = [], stops = [];
async function server(configure) {
  const state = {};
  const http = createServer((request, response) => {
    state.request = request; state.response = response;
    if (configure) configure(response);
    else { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.flushHeaders(); }
  });
  servers.push(http); await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  return { state, base: 'http://127.0.0.1:' + http.address().port };
}
async function open(configure, extra = {}) {
  const fixture = await server(configure), feedback = [], lost = [];
  const stop = await subscribePlaygroundFeedback({ base: fixture.base, token: 'synthetic-token', sessionId,
    onFeedback: value => feedback.push(value), onLost: value => lost.push(value), ...extra });
  stops.push(stop); return { ...fixture, feedback, lost, stop };
}
const message = (status, extra = {}) => ({ session: sessionId, epoch, seq: 1, status, ...extra });
const event = (response, name, value) => response.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  for (const http of servers.splice(0)) { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); }
});

it('establishes authenticated subscription and forwards accepted only as distinct admission metadata', async () => {
  const f = await open();
  expect(f.state.request.url).toBe('/v1/sessions/' + sessionId + '/events');
  expect(f.state.request.headers.authorization).toBe('Bearer synthetic-token');
  event(f.state.response, 'snapshot', message('snapshot'));
  event(f.state.response, 'feedback', message('pending'));
  await delay(10); expect(f.feedback).toEqual([]); expect(f.lost).toEqual([]);
  event(f.state.response, 'feedback', message('accepted'));
  await expect.poll(() => f.feedback).toEqual([message('accepted')]);
  expect(f.feedback.some(value => ['applied', 'completed'].includes(value.status))).toBe(false);
  event(f.state.response, 'feedback', message('applied', { privatePayload: 'not forwarded' }));
  event(f.state.response, 'feedback', message('completed'));
  await expect.poll(() => f.feedback.length).toBe(3);
  expect(f.feedback).toEqual([message('accepted'), message('applied'), message('completed')]);
});

it('handles UTF-8 chunk splits, CRLF comments and multiline JSON without leaking extra data', async () => {
  const f = await open();
  const bytes = Buffer.from(': heartbeat\r\nevent: feedback\r\ndata: {\r\ndata: "session":"' + sessionId + '","epoch":"' + epoch + '",\r\ndata: "seq":2,"status":"applied","note":"雪"\r\ndata: }\r\n\r\n');
  const cut = bytes.indexOf(Buffer.from('雪')) + 1;
  f.state.response.write(bytes.subarray(0, cut)); await delay(5);
  f.state.response.write(bytes.subarray(cut, cut + 1)); await delay(5);
  f.state.response.write(bytes.subarray(cut + 1));
  await expect.poll(() => f.feedback.length).toBe(1);
  expect(f.feedback[0]).toEqual(message('applied', { seq: 2 })); expect(f.lost).toEqual([]);
});

it.each([
  ['gap', response => event(response, 'gap', { lost: 1 }), 'playground_sse_gap'],
  ['closed', response => event(response, 'feedback', message('closed')), 'playground_sse_closed'],
  ['disconnect', response => response.end(), 'playground_sse_disconnected'],
  ['bad JSON', response => response.write('event: feedback\ndata: private invalid text\n\n'), 'playground_sse_invalid_event'],
  ['oversize', response => response.write('data: ' + 'x'.repeat(70000)), 'playground_sse_overflow'],
  ['foreign session', response => event(response, 'feedback', message('applied', { session: epoch })), 'playground_sse_invalid_event'],
  ['invalid UTF-8', response => response.write(Buffer.from([0xff, 0x0a])), 'playground_sse_encoding'],
  ['truncated UTF-8', response => response.end(Buffer.from([0xe9])), 'playground_sse_encoding'],
  ['non-string epoch', response => event(response, 'feedback', message('applied', { epoch: [epoch] })), 'playground_sse_invalid_event']
])('fails closed once for %s and never reconnects', async (_name, write, code) => {
  const f = await open(); write(f.state.response);
  await expect.poll(() => f.lost).toEqual([code]);
  expect(f.feedback).toEqual([]); f.stop(); await delay(5); expect(f.lost).toHaveLength(1);
});

it('intentional stop is idempotent and suppresses disconnect loss', async () => {
  const f = await open(); f.stop(); f.stop(); await delay(20);
  expect(f.lost).toEqual([]); expect(f.feedback).toEqual([]);
});

it.each([401, 302, 200])('rejects unauthenticated, redirected or non-SSE startup (%s)', async status => {
  const fixture = await server(response => { response.writeHead(status, { 'Content-Type': 'text/plain', Location: 'https://example.com' }); response.end('private'); });
  await expect(subscribePlaygroundFeedback({ base: fixture.base, token: 'synthetic-token', sessionId, onFeedback() {}, onLost() {} })).rejects.toThrow('playground_sse_connect');
});

it('bounds response startup without imposing that deadline on healthy streaming', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    let blockedSignal;
    const blocked = subscribePlaygroundFeedback({ base: 'http://127.0.0.1', token: 'synthetic-token', sessionId,
      onFeedback() {}, onLost() {}, startTimeoutMs: 25, fetchImpl: (_url, { signal }) => {
        blockedSignal = signal;
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
      } });
    const expired = expect(blocked).rejects.toThrow('playground_sse_start_timeout');
    await vi.advanceTimersByTimeAsync(24); expect(blockedSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await expired; expect(blockedSignal.aborted).toBe(true);

    let stream, healthySignal, delivered;
    const body = new ReadableStream({ start(controller) { stream = controller; } });
    const feedback = [], lost = [], received = new Promise(resolve => { delivered = resolve; });
    const stop = await subscribePlaygroundFeedback({ base: 'http://127.0.0.1', token: 'synthetic-token', sessionId,
      startTimeoutMs: 25, onFeedback: value => { feedback.push(value); delivered(); }, onLost: value => lost.push(value),
      fetchImpl: async (_url, { signal }) => { healthySignal = signal; return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }); } });
    stops.push(stop); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(healthySignal.aborted).toBe(false); expect(lost).toEqual([]);
    stream.enqueue(new TextEncoder().encode(`event: feedback\ndata: ${JSON.stringify(message('applied'))}\n\n`));
    await received; expect(feedback).toEqual([message('applied')]);
    stop(); expect(healthySignal.aborted).toBe(true); expect(lost).toEqual([]);
  } finally { vi.useRealTimers(); }
});

it('rejects remote or credential-bearing endpoints and malformed ownership before fetch', async () => {
  for (const patch of [{ base: 'https://127.0.0.1' }, { base: 'http://example.com' }, { base: 'http://user:pass@localhost' }, { base: 'http://localhost?token=private' }, { sessionId: '../other' }]) {
    await expect(subscribePlaygroundFeedback({ base: 'http://localhost', token: 'synthetic-token', sessionId,
      onFeedback() {}, onLost() {}, ...patch })).rejects.toThrow('playground_sse_configuration');
  }
});
