import { expect, it, vi } from 'vitest';
import { EpochInbox } from '../src/adapters/epoch-inbox';
import { HttpGatewayConnection } from '../src/adapters/http-gateway-client';
import type { GatewayEvent } from '../src/adapters/gateway-client';

const event = (kind: GatewayEvent['kind'], epoch: string): GatewayEvent => ({ kind, epoch, id: epoch, record: {} });
it('holds a future expression until its epoch arrives, preserving per-epoch order', () => {
  const inbox = new EpochInbox();
  expect(inbox.accept(event('epoch', 'old'))).toHaveLength(1);
  inbox.accept(event('closed', 'released'));
  expect(inbox.accept(event('expression', 'new'))).toEqual([]);
  expect(inbox.accept(event('epoch', 'new')).map(item => item.kind)).toEqual(['epoch', 'expression']);
  expect(inbox.accept(event('expression', 'old'))).toHaveLength(1);
});
it('bounds unknown-epoch buffering and clears cancelled work', () => {
  const inbox = new EpochInbox();
  for (let i = 0; i < 4; i++) inbox.accept(event('expression', 'future'));
  expect(() => inbox.accept(event('expression', 'future'))).toThrow('bridge_epoch_buffer_limit');
  inbox.accept(event('closed', 'released'));
  expect(inbox.accept(event('epoch', 'future'))).toHaveLength(1);
});
it('orders an early expression on the actual HTTP SSE reader path', async () => {
  const records = [event('epoch', 'old'), event('closed', 'released'), event('expression', 'new'), event('epoch', 'new')];
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(records.map(record => `data: ${JSON.stringify(record)}\n\n`).join('')));
    controller.close();
  } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/events') ? new Response(stream) : new Response('{}')));
  const connection = new HttpGatewayConnection('http://127.0.0.1:12345', 'synthetic-test-token'), received: GatewayEvent[] = [];
  try {
    await connection.subscribe(e => received.push(e));
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(received.map(e => `${e.kind}:${e.epoch}`)).toEqual(['epoch:old', 'closed:released', 'epoch:new', 'expression:new']);
  } finally { connection.dispose(); vi.unstubAllGlobals(); }
});
it('accepts a large SSE batch of individually bounded geometry records', async () => {
  const records = [event('epoch', 'active'), ...Array.from({ length: 4 }, () => ({ ...event('expression', 'active'),
    record: { body: 'x'.repeat(20000) } }))];
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(records.map(record => `data: ${JSON.stringify(record)}\n\n`).join('')));
    controller.close();
  } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/events') ? new Response(stream) : new Response('{}')));
  const connection = new HttpGatewayConnection('http://127.0.0.1:12345', 'synthetic-test-token'), received: GatewayEvent[] = [];
  try {
    await connection.subscribe(e => received.push(e));
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(received).toHaveLength(5);
  } finally { connection.dispose(); vi.unstubAllGlobals(); }
});
