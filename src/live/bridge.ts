import { HttpGatewayConnection } from '../adapters/http-gateway-client';
import type { LiveBody } from './body';
import type { FaceObservations } from './observation';
import { element } from './view';
import type { LiveEventKind } from '../core/live/types';

export class LiveBridge {
  private connection?: HttpGatewayConnection;
  private socket?: WebSocket;
  private pending: { type: LiveEventKind; at: number }[] = [];
  private sent = -1;
  private timer?: ReturnType<typeof setInterval>;
  private connected = false;
  constructor(private body: LiveBody, private observations: FaceObservations) {}
  async connect(base: string, token: string) {
    if (this.connection) throw Error('live_already_paired');
    this.connection = new HttpGatewayConnection(base, token);
    await this.connection.subscribe(event => {
      if (event.kind === 'epoch') this.body.epoch(event.epoch, true);
      if (event.kind === 'closed') this.body.epoch(event.epoch, true);
      if (event.kind === 'expression') {
        const result = this.body.admit(event.record);
        void this.connection?.complete(event.id, result.status, result.code);
      }
    });
    this.body.feedback = event => { void this.connection?.feedback(event.epoch, event.seq, event.status); };
    const url = new URL('/v1/live/channel', base); url.protocol = 'ws:';
    const socket = this.socket = new WebSocket(url);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token, sessionId: this.observations.snapshot.sessionId }));
    socket.onmessage = event => { void this.receive(JSON.parse(event.data)); };
    socket.onclose = () => { this.connected = false; element('connection').textContent = 'Mất kết nối Live'; };
    socket.onerror = () => { element('fault').textContent = 'Không nối được gateway Live.'; };
    this.timer = setInterval(() => this.publish(), 100);
  }
  events(events: { type: LiveEventKind; at: number }[]) { this.pending.push(...events); this.pending = this.pending.slice(-16); }
  private publish() {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 32768) return;
    if (this.sent === this.observations.snapshot.seq) return;
    this.socket.send(JSON.stringify({ type: 'observation', snapshot: this.observations.snapshot, events: this.pending.splice(0) }));
    this.sent = this.observations.snapshot.seq;
  }
  private async receive(message: any) {
    if (message.type === 'ready') {
      this.connected = true;
      if (this.observations.snapshot.camera !== 'tracking') this.observations.status(this.observations.snapshot.camera, Date.now());
      element('connection').textContent = 'Đã nối gateway / look tổng hợp';
    }
    if (message.type !== 'look' || message.synthetic !== true) return;
    const indicator = element('look-indicator'); indicator.hidden = false; indicator.textContent = 'Look ảnh tổng hợp: ' + String(message.reason).slice(0, 240);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 360;
    const context = canvas.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, 480, 360);
    context.fillStyle = '#e02121'; context.beginPath(); context.arc(240, 140, 90, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#111'; context.font = 'bold 48px sans-serif'; context.textAlign = 'center';
    context.fillText(String(crypto.getRandomValues(new Uint16Array(1))[0] % 9000 + 1000), 240, 300);
    this.socket?.send(JSON.stringify({ type: 'look_result', id: message.id, synthetic: true, mimeType: 'image/jpeg',
      data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], width: canvas.width, height: canvas.height }));
    setTimeout(() => { indicator.hidden = true; }, 2000);
  }
  stop() { clearInterval(this.timer); this.socket?.close(); this.connection?.dispose(); this.body.feedback = undefined; }
}
