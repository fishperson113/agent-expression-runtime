import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { socketAddress } from '../integrations/herdr.mjs';
import { openControl, sendControl, controlAddress } from '../integrations/terminal-ipc.mjs';
import { brailleFrame } from '../integrations/pane-display.mjs';

it('uses platform-native local sockets without putting credentials in discovery files', () => {
  expect(socketAddress('C:\\herdr.sock', 'win32')).toBe('\\\\.\\pipe\\C:\\herdr.sock');
  expect(socketAddress('/tmp/herdr.sock', 'linux')).toBe('/tmp/herdr.sock');
  expect(controlAddress('pane', 'namespace', 'win32')).toMatch(/^\\\\.\\pipe\\fisch-/);
});
it('binds requests to the existing agent pane and preserves structured errors', async () => {
  const namespace = process.env.HERDR_SOCKET_PATH;
  process.env.HERDR_SOCKET_PATH = 'test-' + randomUUID();
  const id = 'agent-' + randomUUID();
  const server = await openControl(id, message => {
    if (message.method === 'bad') throw Object.assign(Error('range'), { code: 'range', path: '$.body.durationMs' });
    return { status: 'accepted', body: message.args };
  });
  try {
    await expect(openControl(id, () => ({}))).rejects.toThrow();
    expect(await sendControl('express', { type: 'wait', durationMs: 1 }, id)).toMatchObject({ status: 'accepted' });
    expect(await sendControl('bad', {}, id)).toMatchObject({ status: 'rejected', path: '$.body.durationMs' });
    await expect(sendControl('status', {}, id + '-other')).rejects.toThrow('No Fisch body');
  } finally {
    await server.close();
    if (namespace === undefined) delete process.env.HERDR_SOCKET_PATH; else process.env.HERDR_SOCKET_PATH = namespace;
  }
});
it('renders actual RGB particles into pane text when the client cannot display inline pixels', () => {
  const pixels = Buffer.alloc(2 * 4 * 3);
  pixels[1] = 255;
  expect(brailleFrame(pixels, 2, 4, 1, 1)).toBe('\u2801');
});
it.each([[255, 0, 0], [0, 0, 255], [255, 0, 255], [0, 255, 0]])('keeps Braille particles visible in RGB %j', (...color) => {
  const pixels = Buffer.alloc(2 * 4 * 3);
  pixels.set(color, 0);
  expect(brailleFrame(pixels, 2, 4, 1, 1)).toBe('\u2801');
  expect(brailleFrame(pixels, 2, 4, 1, 1, true)).toContain('\x1b[38;2;' + color.join(';') + 'm');
});
