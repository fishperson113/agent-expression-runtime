import { liveTestClient } from '../../integrations/live-test-client.mjs';

const nativeClosed = () => Object.assign(Error('fixture_native_closed'), { code: 'fixture_native_closed' });
export function fixtureNativeCall(child, next) {
  let failure, rejectClosed;
  const unavailable = new Promise((_, reject) => { rejectClosed = reject; }); unavailable.catch(() => {});
  const fail = error => { if (!failure) { failure = error; rejectClosed(error); } };
  child.stdin.on('error', error => fail(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'].includes(error.code) ? nativeClosed() : error));
  child.once('exit', () => fail(nativeClosed())); child.stdin.once('close', () => fail(nativeClosed()));
  const available = () => !failure && child.exitCode === null && child.signalCode === null && child.stdin.writable && !child.stdin.destroyed;
  const call = async command => {
    if (!available()) throw failure ?? nativeClosed();
    const written = new Promise((resolve, reject) => child.stdin.write(JSON.stringify(command) + '\n', error => {
      if (error) { fail(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'].includes(error.code) ? nativeClosed() : error); reject(failure); } else resolve();
    }));
    await Promise.race([written, unavailable]);
    const reply = await Promise.race([next(), unavailable]);
    if (reply.type !== 'result') throw Error('fixture_native_reply');
    return reply.value;
  };
  call.available = available; return call;
}

export async function externalPlayground(base, token, nativeCall, signal, clientFactory = liveTestClient) {
  const client = clientFactory(base, token); let closed = false, closing, pending;
  const close = () => closing ??= (async () => { closed = true; signal?.removeEventListener('abort', stop); await client.close(); })();
  const stop = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  const tool = async (name, args = {}) => {
    if (closed) throw Error('external_controller_closed');
    const result = await client.tool(name, args), value = JSON.parse(result.content[0].text);
    if (result.isError && value.status !== 'uncertain') throw Error('external_mcp_' + (value.code ?? 'rejected'));
    return value;
  };
  const action = async command => {
    if (['state', 'inspectState'].includes(command.operation)) return tool('playground_state', { includeScene: command.includeScene ?? command.operation === 'inspectState' });
    if (command.operation === 'express') return tool('express', { body: { type: 'morph', target: 'wall', durationMs: 100 } });
    if (command.operation === 'interrupt') return tool('cancel_expression');
    const snapshot = await tool('playground_state');
    return tool('playground_edit', { operation: command.operation, expectedRevision: snapshot.revision,
      ...(['create', 'remix'].includes(command.operation) ? { scene: command.scene } : {}) });
  };
  const call = async command => {
    if (['selectThread', 'failedSelect'].includes(command.operation)) return nativeCall(command);
    if (command.operation === 'inspectState') return action(command);
    const ack = await nativeCall(command), value = await action(command);
    if (!closed) {
      try { await nativeCall({ operation: 'complete', turnId: ack.turnId }); }
      catch (error) { if (error.code !== 'fixture_native_closed') throw error; }
    }
    return value;
  };
  try {
    if (signal?.aborted) throw Error('external_controller_closed');
    await client.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'independent-playground-test', version: '1' } });
    const { tools } = await client.call('tools/list');
    if (closed) throw Error('external_controller_closed');
    return { lane: 'independent-mcp', tools: tools.map(t => t.name), call, close,
      send(command) { if (pending) throw Error('external_pending'); pending = call(command); pending.catch(() => {}); },
      async next() { if (!pending) throw Error('external_no_pending'); try { return { type: 'result', value: await pending }; } finally { pending = undefined; } } };
  } catch (error) { await close(); throw error; }
}
