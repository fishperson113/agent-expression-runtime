import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { liveTestClient, toolValue } from '../integrations/live-test-client.mjs';

async function fixture(run) {
  const id = randomUUID(), epoch = randomUUID(), token = 'synthetic-expression-status';
  let stream, creates = 0, sends = 0;
  const event = status => stream.write(`event: feedback\ndata: ${JSON.stringify({ session: id, epoch, seq: 1, status })}\n\n`);
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    if (req.url.endsWith('/events')) {
      stream = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('content-type', 'application/json');
    if (req.method === 'DELETE') { res.end('{}'); return; }
    if (req.url === '/v1/sessions') { creates++; res.end(JSON.stringify({ id, epoch })); return; }
    if (req.url.endsWith('/cancel')) { res.end(JSON.stringify({ epoch: randomUUID() })); return; }
    sends++;
    if (JSON.parse(body).requestId === 'rejected') {
      res.writeHead(422); res.end(JSON.stringify({ session: id, epoch, seq: 2, status: 'rejected', code: 'fixture_rejected' })); return;
    }
    event('applied');
    res.end(JSON.stringify({ session: id, epoch, seq: 1, status: 'accepted' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = liveTestClient(`http://127.0.0.1:${server.address().port}`, token);
  try { await run({ client, event, gap: () => stream.write('event: gap\ndata: {}\n\n'),
    disconnect: () => stream.end(), counters: () => ({ creates, sends }) }); }
  finally { await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const expression = { requestId: 'own', body: { type: 'morph', target: 'wall', durationMs: 100 } };
async function status(client, id = 'own') { return toolValue(await client.tool('expression_status', { requestId: id })); }
async function waitStatus(client, expected) {
  for (let n = 0; n < 30; n++) {
    const value = await status(client); if (value.status === expected) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error(`missing status ${expected}`);
}
describe('external MCP lifecycle inspection', () => {
  it('retains definitive non-2xx admission rejection separately from transport uncertainty', async () => {
    await fixture(async ({ client }) => {
      expect((await client.tool('express', { ...expression, requestId: 'rejected' })).isError).toBe(true);
      expect(await status(client, 'rejected')).toMatchObject({ status: 'rejected', admission: 'rejected', visibility: 'unknown' });
    });
  });
  it('reads without connection, captures early application, and preserves completion on late cancel and duplicate ACK', async () => {
    await fixture(async ({ client, event, counters }) => {
      expect((await status(client)).reason).toBe('not_retained'); expect(counters().creates).toBe(0);
      expect(toolValue(await client.tool('express', expression)).requestId).toBe('own');
      expect(await waitStatus(client, 'applied')).toMatchObject({ admission: 'accepted', visibility: 'unknown' });
      event('completed'); await waitStatus(client, 'completed'); event('cancelled');
      await client.tool('express', expression);
      expect((await status(client)).status).toBe('completed');
      const reused = await client.tool('express', { ...expression, body: { ...expression.body, durationMs: 200 } });
      expect(reused.isError).toBe(true); expect(counters().sends).toBe(2);
    });
  });
  it.each(['gap', 'disconnect'])('fails closed after %s without read reconnect or replay', async failure => {
    await fixture(async context => {
      await context.client.tool('express', expression); await waitStatus(context.client, 'applied');
      context[failure](); expect((await waitStatus(context.client, 'unknown')).visibility).toBe('unknown');
      await status(context.client); expect(context.counters()).toEqual({ creates: 1, sends: 1 });
    });
  });
  it('marks cancellation ACK as uncertainty rather than invented renderer cancellation', async () => {
    await fixture(async ({ client, counters }) => {
      await client.tool('express', expression); await waitStatus(client, 'applied');
      await client.tool('cancel_expression');
      expect(await status(client)).toMatchObject({ status: 'unknown', reason: 'cancel_acknowledged' });
      expect(counters().creates).toBe(1);
    });
  });
});
