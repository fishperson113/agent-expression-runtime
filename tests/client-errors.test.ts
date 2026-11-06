import { expect, it } from 'vitest';
import { ExpressionClient } from '../src/integrations/client';
it.each([400, 401, 413, 422])(
  'normalizes a text HTTP %i rejection without leaking extractor text',
  async (status) => {
    const transport = (async () =>
      new Response('private extractor details', { status })) as typeof fetch;
    const client = new ExpressionClient('http://127.0.0.1:1234', 'synthetic', transport);
    await expect(client.capabilities()).rejects.toThrow(`http_${status}`);
  },
);
it('reports invalid success JSON with a stable error code', async () => {
  const transport = (async () => new Response('not JSON', { status: 200 })) as typeof fetch;
  await expect(
    new ExpressionClient('http://127.0.0.1:1234', 'synthetic', transport).capabilities(),
  ).rejects.toThrow('invalid_gateway_response');
});
