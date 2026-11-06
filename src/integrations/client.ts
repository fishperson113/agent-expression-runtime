import type { Node } from '../core/ast/types';
export type ExpressionCommand = {
  body: Node | Record<string, unknown>;
  kind?: 'program' | 'state' | 'define';
  track?: 'body';
  policy?: 'replace' | 'append';
  ttlMs?: number;
  requestId?: string;
};
export type Receipt = {
  id: string;
  session: string;
  epoch: string;
  seq: number;
  status: string;
  code?: string;
};
export class ExpressionClient {
  private session?: { id: string; epoch: string };
  constructor(
    private baseUrl: string,
    private token: string,
    private transport: typeof fetch = fetch,
  ) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error('loopback_url_required');
  }
  private async request(path: string, body?: unknown) {
    const response = await this.transport(this.baseUrl + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error(response.ok ? 'invalid_gateway_response' : `http_${response.status}`);
    }
    if (!response.ok) throw Error(result.code ?? `http_${response.status}`);
    return result;
  }
  capabilities() {
    return this.request('/v1/capabilities');
  }
  async connect() {
    this.session = await this.request('/v1/sessions', {});
    return this.session!;
  }
  async express(command: ExpressionCommand): Promise<Receipt> {
    if (!this.session) throw Error('not_connected');
    return this.request(`/v1/sessions/${this.session.id}/expressions`, {
      ...command,
      epoch: this.session.epoch,
      requestId: command.requestId ?? crypto.randomUUID(),
    });
  }
  async cancel() {
    if (!this.session) throw Error('not_connected');
    const result = await this.request(`/v1/sessions/${this.session.id}/cancel`, {
      epoch: this.session.epoch,
    });
    this.session.epoch = result.epoch;
    return result;
  }
  /** Host can dispatch without awaiting; it must still handle rejections. Tool hosts may serialize. */
  dispatch(command: ExpressionCommand, onError: (code: string) => void) {
    void this.express(command).catch((e) =>
      onError(e instanceof Error ? e.message : 'transport_error'),
    );
  }
  async *events(
    signal: AbortSignal,
    lastEventId?: string,
  ): AsyncGenerator<{ event: string; id?: string; data: unknown }> {
    if (!this.session) throw Error('not_connected');
    const response = await this.transport(`${this.baseUrl}/v1/sessions/${this.session.id}/events`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
      },
      signal,
      redirect: 'error',
    });
    if (!response.ok || !response.body) throw Error(`sse_${response.status}`);
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 65536) throw Error('sse_buffer_limit');
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let event = 'message',
            id: string | undefined,
            data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            if (line.startsWith('id:')) id = line.slice(3).trim();
            if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) yield { event, id, data: JSON.parse(data) };
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
