import net from 'node:net';

export function socketAddress(path, platform = process.platform) {
  if (!path) throw Object.assign(Error('The --agent adapter requires Herdr. Use fisch live without --agent in a normal terminal.'), { public: true });
  return platform === 'win32' && !path.startsWith('\\\\.\\pipe\\') ? '\\\\.\\pipe\\' + path : path;
}
export function herdrCall(method, params = {}, path = process.env.HERDR_SOCKET_PATH) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const socket = net.connect(socketAddress(path), () => socket.write(JSON.stringify({ id: 'fisch', method, params }) + '\n'));
    const fail = error => { socket.destroy(); reject(error); };
    socket.setTimeout(3500, () => fail(Error('Herdr request timed out.')));
    socket.on('error', fail);
    socket.on('end', () => reject(Error('Herdr closed the connection.')));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 2_000_000) return fail(Error('Herdr response exceeds the frame budget.'));
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      try {
        const message = JSON.parse(buffer.slice(0, end)); socket.destroy();
        if (message.error) reject(Object.assign(Error(message.error.message), { code: message.error.code }));
        else resolve(message.result);
      } catch (error) { fail(error); }
    });
  });
}
