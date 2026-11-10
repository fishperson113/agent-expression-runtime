import { HttpGatewayConnection } from '../adapters/http-gateway-client';
import type { LiveBody } from './body';
import type { FaceObservations } from './observation';
import { element } from './view';
import type { LiveSourceEvent } from '../core/live/types';
import { unavailableUser } from '../core/live/types';

export class LiveBridge {
  private connection?: HttpGatewayConnection;
  private socket?: WebSocket;
  private pending: LiveSourceEvent[] = [];
  private sent = -1;
  private timer?: ReturnType<typeof setInterval>;
  private connected = false;
  private stopped = false;
  private inspection = 0;
  constructor(private body: LiveBody, private observations: FaceObservations, private resetReactive = () => {}, private observeReactive = () => {}, private coordination?: () => unknown) {}
  async connect(base: string, token: string) {
    if (this.connection) throw Error('live_already_paired');
    this.connection = new HttpGatewayConnection(base, token);
    await this.connection.subscribe(event => {
      if (event.kind === 'epoch') { this.resetReactive(); this.body.epoch(event.epoch, !!event.id); }
      if (event.kind === 'closed') { this.resetReactive(); this.body.epoch(event.epoch, true); }
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
    socket.onclose = () => { this.resetReactive(); this.connected = false; if (!this.stopped) element('connection').textContent = 'Mất kết nối Live'; };
    socket.onerror = () => { element('fault').textContent = 'Không nối được gateway Live.'; };
    this.timer = setInterval(() => this.publish(), 100);
  }
  events(events: LiveSourceEvent[]) { this.pending.push(...events); this.pending = this.pending.slice(-16); }
  async cancel() {
    this.resetReactive(); this.body.epoch(crypto.randomUUID());
    try { await this.connection?.revoke(); }
    catch { element('fault').textContent = 'Đã dừng tại renderer; nối lại Live trước biểu đạt mới.'; }
  }
  private publish() {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 32768) return;
    if (this.sent === this.observations.snapshot.seq) return;
    const snapshot = this.observations.snapshot;
    const outgoing = Date.now() - snapshot.capturedAt > 1500 ? { ...snapshot, capturedAt: Date.now(), camera: 'stale',
      user: unavailableUser(), summary: 'Quan sát đã cũ; trạng thái người dùng chưa biết.' } : snapshot;
    if (outgoing.camera === 'stale') delete outgoing.hands;
    this.socket.send(JSON.stringify({ type: 'observation', snapshot: outgoing, events: this.pending.splice(0) }));
    this.sent = this.observations.snapshot.seq;
  }
  private async receive(message: any) {
    if (message.type === 'ready') {
      this.connected = true;
      if (this.observations.snapshot.camera !== 'tracking') this.observations.status(this.observations.snapshot.camera, Date.now());
      this.observeReactive();
      element('connection').textContent = 'Đã nối gateway / look tổng hợp';
    }
    if (message.type === 'inspect_expression') { await this.inspect(message); return; }
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
  private async inspect(message: any) {
    const socket = this.socket, epoch = this.body.scheduler.epoch;
    if (message.epoch !== epoch || !socket || this.stopped || document.hidden || this.body.controls.mode === 'off') return;
    const before = this.body.renderer.contentFrame, generation = message.coordinationOnly === true ? this.inspection : ++this.inspection;
    const indicator = element('look-indicator');
    if (message.coordinationOnly !== true) { indicator.hidden = false; indicator.textContent = 'Kiểm tra output renderer (không camera)'; }
    try {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (document.hidden || String(this.body.controls.mode) === 'off' || this.stopped || socket !== this.socket || socket.readyState !== WebSocket.OPEN || this.body.scheduler.epoch !== epoch) return;
    const summary = this.body.renderer.inspectOutput();
    if (summary.contentFrame <= before || summary.contextLost) return;
    socket.send(JSON.stringify({ type: 'render_output', id: message.id, epoch, summary, ...(this.coordination ? { coordination: this.coordination() } : {}) }));
    } finally { if (message.coordinationOnly !== true) setTimeout(() => { if (generation === this.inspection) indicator.hidden = true; }, 2000); }
  }
  stop() { this.stopped = true; clearInterval(this.timer); this.socket?.close(); this.connection?.dispose(); this.body.feedback = undefined; }
}
