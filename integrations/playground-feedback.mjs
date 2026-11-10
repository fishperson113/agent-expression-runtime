const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 65536;

function configuration(options) {
  let url;
  try { url = new URL(options.base); } catch { throw Error('playground_sse_configuration'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || typeof options.sessionId !== 'string' || !UUID.test(options.sessionId) ||
      typeof options.token !== 'string' || !options.token.length || options.token.length > 4096 || /[\r\n]/.test(options.token) ||
      typeof options.onFeedback !== 'function' || typeof options.onLost !== 'function' ||
      !Number.isInteger(options.startTimeoutMs) || options.startTimeoutMs < 1 || options.startTimeoutMs > 30000)
    throw Error('playground_sse_configuration');
  return new URL('/v1/sessions/' + options.sessionId + '/events', url);
}

async function connect(options, url, controller) {
  let timer, timedOut = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); reject(Error('playground_sse_start_timeout')); }, options.startTimeoutMs);
  });
  try {
    const response = await Promise.race([options.fetchImpl(url, { headers: { Authorization: 'Bearer ' + options.token },
      redirect: 'error', signal: controller.signal }), deadline]);
    if (!response.ok || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body?.getReader) {
      void response.body?.cancel().catch(() => {}); throw Error('playground_sse_connect');
    }
    return response.body.getReader();
  } catch { throw Error(timedOut ? 'playground_sse_start_timeout' : 'playground_sse_connect'); }
  finally { clearTimeout(timer); }
}

function dispatch(name, text, options, fail) {
  if (name === 'gap') { fail('playground_sse_gap'); return; }
  let value;
  try { value = JSON.parse(text); } catch { fail('playground_sse_invalid_event'); return; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.session !== options.sessionId ||
      typeof value.epoch !== 'string' || !UUID.test(value.epoch) || !Number.isSafeInteger(value.seq) || value.seq < 0) {
    fail('playground_sse_invalid_event'); return;
  }
  if (name === 'snapshot' && value.status === 'snapshot') return;
  if (name !== 'feedback') { fail('playground_sse_invalid_event'); return; }
  if (value.status === 'closed') { fail('playground_sse_closed'); return; }
  if (value.status === 'pending') return;
  if (!['accepted', 'applied', 'completed', 'cancelled', 'rejected'].includes(value.status)) { fail('playground_sse_invalid_event'); return; }
  if (value.requestId !== undefined && value.requestId !== null && (typeof value.requestId !== 'string' || !value.requestId.length || value.requestId.length > 128)) { fail('playground_sse_invalid_event'); return; }
  try { options.onFeedback({ ...(value.requestId ? { requestId: value.requestId } : {}), session: value.session, epoch: value.epoch, seq: value.seq, status: value.status }); }
  catch { fail('playground_sse_callback'); }
}

function parser(options, fail, stopped) {
  let buffer = '', name = 'message', lines = [], bytes = 0;
  return text => {
    buffer += text;
    let end, events = 0;
    while (!stopped() && (end = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, end), line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      buffer = buffer.slice(end + 1);
      bytes += Buffer.byteLength(raw) + 1;
      if (bytes > LIMIT) { fail('playground_sse_overflow'); return; }
      if (!line.length) {
        if (++events > 64) { fail('playground_sse_overflow'); return; }
        if (lines.length || name === 'gap') dispatch(name, lines.join('\n'), options, fail);
        name = 'message'; lines = []; bytes = 0; continue;
      }
      if (line[0] === ':') continue;
      const colon = line.indexOf(':'), field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1); if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') name = value;
      if (field === 'data') lines.push(value);
    }
    if (Buffer.byteLength(buffer) + bytes > LIMIT) fail('playground_sse_overflow');
  };
}

async function consume(reader, options, fail, stopped) {
  const decoder = new TextDecoder('utf-8', { fatal: true }), parse = parser(options, fail, stopped);
  try {
    while (!stopped()) {
      const { value, done } = await reader.read();
      if (done) {
        try { decoder.decode(); } catch { fail('playground_sse_encoding'); break; }
        if (!stopped()) fail('playground_sse_disconnected'); break;
      }
      if (value.byteLength > LIMIT) { fail('playground_sse_overflow'); break; }
      let text;
      try { text = decoder.decode(value, { stream: true }); } catch { fail('playground_sse_encoding'); break; }
      parse(text);
    }
  } catch { if (!stopped()) fail('playground_sse_disconnected'); }
  finally { try { reader.releaseLock(); } catch {} }
}

export async function subscribePlaygroundFeedback(input) {
  const options = { fetchImpl: fetch, startTimeoutMs: 2000, ...input }, url = configuration(options);
  const controller = new AbortController();
  const reader = await connect(options, url, controller);
  let done = false;
  const stop = () => {
    if (done) return; done = true; controller.abort(); void reader.cancel().catch(() => {});
  };
  const fail = code => {
    if (done) return; stop();
    try { options.onLost(code); } catch {}
  };
  void consume(reader, options, fail, () => done);
  return stop;
}
