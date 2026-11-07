import type { GatewayEvent } from './gateway-client';
import { EpochInbox } from './epoch-inbox';
/** Browser renderer bridge. The pairing credential stays in process memory and Authorization headers. */
export class HttpGatewayConnection {
  private abort = new AbortController();
  private sessionId?: string;
  constructor(
    private baseUrl: string,
    private token: string,
  ) {
    const u = new URL(baseUrl);
    if (
      u.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw Error('loopback_url_required');
  }
  private async post(path: string, body: unknown) {
    const r = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) throw Error(`http_${r.status}`);
  }
  async subscribe(receive: (event: GatewayEvent) => void) {
    const inbox = new EpochInbox();
    const response = await fetch(this.baseUrl + '/v1/renderer/events', {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: this.abort.signal,
      redirect: 'error',
    });
    if (!response.ok || !response.body) throw Error(`renderer_connect_${response.status}`);
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    void (async () => {
      let buffer = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            if (end > 65536) throw Error('bridge_buffer_limit');
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = block
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim())
              .join('\n');
            if (!data) continue;
            const event = JSON.parse(data) as GatewayEvent;
            if (event.kind === 'epoch' && event.id) this.sessionId = event.id;
            if (event.kind === 'closed') this.sessionId = undefined;
            for (const admitted of inbox.accept(event)) receive(admitted);
            if (event.kind !== 'expression')
              await this.post('/v1/renderer/control-ack', { epoch: event.epoch });
          }
          if (buffer.length > 65536) throw Error('bridge_buffer_limit');
        }
      } finally {
        reader.releaseLock();
      }
    })().catch(() => {
      this.abort.abort();
    });
  }
  async pairing() {
    return { baseUrl: this.baseUrl, token: '[host credential hidden]', protocolVersion: 1 };
  }
  complete(id: string, status: string, code?: string, path?: string) {
    return this.post('/v1/renderer/complete', { id, status, code: code ?? null, path: path ?? null });
  }
  feedback(epoch: string, seq: number, status: string) {
    return this.post('/v1/renderer/feedback', { epoch, seq, status });
  }
  async revoke() {
    if (this.sessionId) {
      const r = await fetch(`${this.baseUrl}/v1/sessions/${this.sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) throw Error(`http_${r.status}`);
    }
  }
  dispose() {
    this.abort.abort();
  }
}
