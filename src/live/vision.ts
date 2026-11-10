import type { FaceSample } from './observation';

export class VisionCamera {
  hands = false;
  private stream?: MediaStream;
  private worker?: Worker;
  private active = false;
  private busy = false;
  private capturedTime = -1;
  private availableTime = -1;
  private availableAt = -1;
  private frameSeq = 0;
  private pendingFrame?: { id: number; availableAt: number; requestedAt: number; mediaTime: number };
  private ready = false;
  private actualDelegate?: 'GPU' | 'CPU';
  private generation = 0;
  private callback = 0;
  private timeout?: ReturnType<typeof setTimeout>;
  constructor(private video: HTMLVideoElement, private receive: (sample: FaceSample) => void,
    private status: (status: string) => void, private delegate: 'GPU' | 'CPU' = 'GPU') {}
  async start() {
    this.stop(); const generation = ++this.generation; this.active = true;
    this.status('starting');
    try {
      this.worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = event => this.message(event.data, generation);
      this.worker.onerror = () => { if (generation === this.generation) this.fail('vision_failed'); };
      this.timeout = setTimeout(() => this.fail('vision_timeout'), 20000);
      this.worker.postMessage({ type: 'init', delegate: this.delegate, ...(this.hands ? { hands: true } : {}) });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!this.active || generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream; this.video.srcObject = stream;
      stream.getVideoTracks()[0].onended = () => this.ended();
      await this.video.play(); this.schedule(generation);
    } catch (error) { if (generation === this.generation) this.fail(error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'camera_failed'); }
  }
  private message(data: any, generation: number) {
    if (generation !== this.generation || !this.active) return;
    if (data.type === 'ready') { this.actualDelegate = data.delegate; this.ready = true; clearTimeout(this.timeout); this.status('ready-' + data.delegate); }
    if (data.type === 'sample' && this.pendingFrame && data.frameId === this.pendingFrame.id) {
      const { id: _id, ...sourceFrame } = this.pendingFrame; this.pendingFrame = undefined; this.busy = false;
      this.receive({ ...data.sample, sourceFrame }); void this.capture(generation);
    }
    if (data.type === 'error') this.fail('vision_failed: ' + String(data.code).slice(0, 180));
  }
  private schedule(generation: number) {
    if (!this.active || generation !== this.generation) return;
    this.callback = this.video.requestVideoFrameCallback((_, metadata) => {
      if (!this.active || generation !== this.generation) return;
      this.availableTime = metadata.mediaTime; this.availableAt = Date.now();
      this.schedule(generation); void this.capture(generation);
    });
  }
  private async capture(generation: number) {
    if (!this.active || generation !== this.generation || !this.ready || this.busy || !this.worker) return;
    const mediaTime = this.availableTime;
    if (mediaTime < 0 || mediaTime === this.capturedTime) return;
    const sourceFrame = { id: ++this.frameSeq, availableAt: this.availableAt, requestedAt: Date.now(), mediaTime };
    this.busy = true; this.capturedTime = mediaTime;
    let frame: ImageBitmap | undefined;
    try {
      frame = await createImageBitmap(this.video);
      if (!this.active || generation !== this.generation) { frame.close(); return; }
      this.pendingFrame = sourceFrame;
      this.worker.postMessage({ type: 'frame', frame, frameId: sourceFrame.id, at: performance.now() }, [frame]); frame = undefined;
    } catch { frame?.close(); if (generation === this.generation) { this.busy = false; this.pendingFrame = undefined; } }
  }
  private fail(code: string) { this.stop(); this.status(code); }
  private ended() {
    const fallback = this.active && (this.actualDelegate ?? this.delegate) === 'GPU'; this.stop();
    if (!fallback) { this.status('stopped'); return; }
    this.delegate = 'CPU'; this.status('recovering-CPU');
    const generation = this.generation;
    this.timeout = setTimeout(() => { if (this.generation === generation) void this.start(); }, 500);
  }
  stop() {
    this.active = false; this.ready = false; this.busy = false; this.capturedTime = -1; this.availableTime = -1; this.availableAt = -1; this.actualDelegate = undefined; this.generation++;
    this.pendingFrame = undefined;
    clearTimeout(this.timeout); this.video.cancelVideoFrameCallback(this.callback);
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = undefined; this.video.srcObject = null;
    this.worker?.terminate(); this.worker = undefined;
  }
}
