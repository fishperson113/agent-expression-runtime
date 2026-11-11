import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const leasePattern = /^[a-f0-9-]{36}$/;
export function desktopIntentBase(value) {
  let url; try { url = new URL(value); } catch { throw Error('desktop_intent_configuration'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('desktop_intent_configuration');
  return url.origin;
}
function credential(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw Error('desktop_intent_configuration');
  return Buffer.from('Bearer ' + token);
}
async function boundedJson(stream) {
  const chunks = []; let length = 0;
  for await (const chunk of stream) { length += chunk.length; if (length > 1024) throw Error('desktop_intent_payload'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function deadline(work, milliseconds) {
  let timer;
  return Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('desktop_intent_barrier')), milliseconds); })]).finally(() => clearTimeout(timer));
}
const response = (res, status, value) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); } };
class DesktopIntentServer {
  leases = new Map(); ended = new Set(); uncertain = false; closed = false; requests = 0;
  constructor({ token, onBegin, onEnd = () => {}, onUncertain = () => {}, leaseMs = 120000, callbackTimeoutMs = 2000, leaseTimers = { set: setTimeout, clear: clearTimeout } } = {}) {
    this.expected = credential(token);
    if (typeof onBegin !== 'function' || typeof onEnd !== 'function' || typeof onUncertain !== 'function' || !Number.isInteger(leaseMs) || leaseMs < 60000 || leaseMs > 300000 || !Number.isInteger(callbackTimeoutMs) || callbackTimeoutMs < 1 || callbackTimeoutMs > 5000) throw Error('desktop_intent_configuration');
    if (typeof leaseTimers?.set !== 'function' || typeof leaseTimers.clear !== 'function') throw Error('desktop_intent_configuration');
    Object.assign(this, { onBegin, onEnd, onUncertain, leaseMs, callbackTimeoutMs, leaseTimers });
    this.server = createServer((req, res) => { void this.handle(req, res); });
    Object.assign(this.server, { maxHeadersCount: 16, maxConnections: 32, requestTimeout: 5000, headersTimeout: 5000 });
  }
  pause(reason) { if (!this.uncertain && !this.closed) { this.uncertain = true; try { void Promise.resolve(this.onUncertain(reason)).catch(() => {}); } catch {} } }
  release(id) { const lease = this.leases.get(id); if (lease) { this.leaseTimers.clear(lease.timer); this.leases.delete(id); } }
  watch(res, id, reason) { res.once('close', () => { if (!res.writableFinished && this.leases.has(id)) { this.release(id); this.pause(reason); } }); }
  async begin(res) {
    if (this.leases.size >= 8) { response(res, 429, { code: 'desktop_intent_capacity' }); return; }
    const id = randomUUID(), lease = { ending: false };
    lease.timer = this.leaseTimers.set(() => { this.release(id); this.pause('lease_expired'); }, this.leaseMs); lease.timer.unref?.(); this.leases.set(id, lease);
    this.watch(res, id, 'begin_unknown');
    try {
      await deadline(() => this.onBegin({ busy: true, uncertain: this.uncertain }), this.callbackTimeoutMs);
      if (this.closed || this.leases.get(id) !== lease) throw Error();
      response(res, 200, { schemaVersion: 1, leaseId: id, uncertain: this.uncertain });
    } catch { this.release(id); this.pause('barrier_failed'); response(res, 503, { code: 'desktop_intent_barrier' }); }
  }
  async end(res, id) {
    const lease = this.leases.get(id);
    if (!lease || lease.ending) { response(res, 409, { code: 'desktop_intent_lease' }); return; }
    lease.ending = true; this.watch(res, id, 'end_unknown');
    try {
      await deadline(() => this.onEnd({ busy: this.leases.size > 1, uncertain: this.uncertain }), this.callbackTimeoutMs);
      if (this.closed || this.leases.get(id) !== lease) throw Error();
      this.release(id); this.ended.add(id); if (this.ended.size > 8) this.ended.delete(this.ended.values().next().value);
      response(res, 200, { schemaVersion: 1, ended: true, uncertain: this.uncertain });
    } catch { this.release(id); this.pause('end_unknown'); response(res, 503, { code: 'desktop_intent_end_unknown' }); }
  }
  async handle(req, res) {
    const given = Buffer.from(req.headers.authorization ?? '');
    if (req.headers.origin !== undefined || given.length !== this.expected.length || !timingSafeEqual(given, this.expected)) { response(res, 403, { code: 'desktop_intent_auth' }); req.resume(); return; }
    if (this.closed || this.requests >= 16) { response(res, 503, { code: 'desktop_intent_unavailable' }); req.resume(); return; }
    if (req.method !== 'POST' || !['/v1/intent/begin', '/v1/intent/end', '/v1/intent/uncertain'].includes(req.url)) { response(res, 404, { code: 'desktop_intent_route' }); req.resume(); return; }
    if (req.headers['content-type'] !== 'application/json') { response(res, 415, { code: 'desktop_intent_payload' }); req.resume(); return; }
    this.requests++;
    try {
      const value = await boundedJson(req);
      if (!object(value)) throw Error();
      if (req.url.endsWith('/begin') && Object.keys(value).length === 0) await this.begin(res);
      else if (Object.keys(value).join() === 'leaseId' && typeof value.leaseId === 'string' && leasePattern.test(value.leaseId)) {
        if (req.url.endsWith('/end')) await this.end(res, value.leaseId);
        else if (this.leases.has(value.leaseId) || this.ended.has(value.leaseId)) { this.pause('client_end_unknown'); response(res, 200, { schemaVersion: 1, paused: true, uncertain: true }); }
        else response(res, 409, { code: 'desktop_intent_lease' });
      } else throw Error();
    } catch { response(res, 400, { code: 'desktop_intent_payload' }); }
    finally { this.requests--; }
  }
  async close() { if (this.closed) return; this.closed = true; for (const id of this.leases.keys()) this.release(id); this.ended.clear(); this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve)); }
}
export async function startDesktopIntentServer(options) {
  const state = new DesktopIntentServer(options), server = state.server;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { base: `http://127.0.0.1:${server.address().port}`, busy: () => state.leases.size > 0, uncertain: () => state.uncertain, close: () => state.close() };
}
export function createDesktopIntentClient({ base, token, timeoutMs = 3000 } = {}) {
  base = desktopIntentBase(base); credential(token);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error('desktop_intent_configuration');
  const call = async (path, body) => {
    try {
      const response = await fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      const value = await boundedJson(response.body);
      if (!response.ok || !object(value) || value.schemaVersion !== 1 || typeof value.uncertain !== 'boolean') throw Error();
      return value;
    } catch { throw Error('desktop_intent_unavailable'); }
  };
  return { begin: async () => { const value = await call('/v1/intent/begin', {});
    if (Object.keys(value).sort().join() !== 'leaseId,schemaVersion,uncertain' || !leasePattern.test(value.leaseId)) throw Error('desktop_intent_unavailable'); return value.leaseId; },
  end: async leaseId => { if (typeof leaseId !== 'string' || !leasePattern.test(leaseId)) throw Error('desktop_intent_unavailable');
    try { const value = await call('/v1/intent/end', { leaseId }); if (Object.keys(value).sort().join() !== 'ended,schemaVersion,uncertain' || value.ended !== true) throw Error(); }
    catch { await call('/v1/intent/uncertain', { leaseId }).catch(() => {}); throw Error('desktop_intent_end_unknown'); } } };
}
