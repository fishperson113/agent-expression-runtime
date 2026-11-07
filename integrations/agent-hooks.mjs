import net from 'node:net';
import { socketAddress } from './herdr.mjs';

export class AgentEventHook {
  connected = false;
  closed = false;
  buffer = '';
  retryMs = 250;
  constructor(paneId, onStatus, path = process.env.HERDR_SOCKET_PATH) {
    this.paneId = paneId; this.onStatus = onStatus; this.path = socketAddress(path);
    this.connect();
  }
  connect() {
    if (this.closed) return;
    this.buffer = '';
    const socket = this.socket = net.connect(this.path, () => {
      socket.write(JSON.stringify({ id: 'fisch-hooks', method: 'events.subscribe', params: {
        subscriptions: [{ type: 'pane.agent_status_changed', pane_id: this.paneId }],
      } }) + '\n');
    });
    const handshake = setTimeout(() => socket.destroy(), 3500);
    socket.on('data', chunk => this.receive(chunk, handshake));
    socket.on('error', () => {});
    socket.once('close', () => {
      clearTimeout(handshake); this.connected = false;
      if (!this.closed) {
        this.timer = setTimeout(() => this.connect(), this.retryMs);
        this.retryMs = Math.min(5000, this.retryMs * 2);
      }
    });
  }
  receive(chunk, handshake) {
    this.buffer += chunk.toString('utf8');
    if (Buffer.byteLength(this.buffer) > 65536) return this.socket.destroy();
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      try {
        const event = JSON.parse(line);
        if (event.error) return this.socket.destroy();
        if (event.result?.type === 'subscription_started') {
          clearTimeout(handshake); this.connected = true; this.retryMs = 250;
        }
        if (event.event === 'pane.agent_status_changed' && event.data?.pane_id === this.paneId)
          this.onStatus(event.data.agent_status);
      } catch { this.socket.destroy(); return; }
    }
  }
  close() {
    this.closed = true; clearTimeout(this.timer); this.socket.destroy();
  }
}

const motion = {
  working: ['cloud', 'orbit', 0.4], blocked: ['wall', 'pulse', 0.15],
  done: ['sphere', 'pulse', 0.2], idle: ['sphere', 'orbit', 0.08], unknown: ['sphere', 'orbit', 0.03],
};
export function activityBody(status) {
  const preset = motion[status];
  if (!preset) return null;
  const [target, field, strength] = preset;
  return { type: 'parallel', children: [
    { type: 'morph', target, durationMs: 700 },
    { type: 'flow', field, strength, durationMs: 700 },
  ] };
}
export function activityHook(engine) {
  let status, transitions = 0;
  return {
    update(next) {
      const body = activityBody(next);
      if (!body || next === status) return false;
      const result = engine.express({ body });
      if (result.status !== 'accepted') return false;
      status = next; transitions++; return true;
    },
    get status() { return status; },
    get transitions() { return transitions; },
  };
}
