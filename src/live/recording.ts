import { CausalRecorder } from '../core/live/causal-recorder';
import type { CausalKind, CausalPayloads } from '../core/live/causal-recorder-types';
import { element } from './view';

export class LiveRecording {
  private recorder: CausalRecorder;
  private closed = false;
  private generation = 0;
  private captureActive = false;
  constructor(epoch: () => string, private mode: 'synthetic' | 'live-structured') {
    this.recorder = new CausalRecorder({ now: () => performance.now(), wallNow: () => Date.now(), epoch });
    element('trace-start').onclick = () => this.start();
    element('trace-stop').onclick = () => this.stop();
    element('trace-clear').onclick = () => this.clear();
    element('trace-export').onclick = () => this.download();
    this.refresh();
  }
  record = <K extends CausalKind>(kind: K, payload: CausalPayloads[K]) => { this.recorder.append(kind, payload); };
  private rotate() {
    if (this.generation >= Number.MAX_SAFE_INTEGER) { this.closed = true; this.recorder.clear(); return; }
    this.generation++;
  }
  private activeState() {
    const state = this.recorder.status();
    if (this.captureActive && !state?.active) { this.captureActive = false; this.rotate(); }
    return state;
  }
  captureToken() {
    const state = this.activeState();
    return !this.closed && state?.active ? Object.freeze({ runId: state.runId, generation: this.generation }) : null;
  }
  providerReceipt(token: unknown, payload: unknown): boolean {
    try {
      const current = this.captureToken();
      if (!current || !token || typeof token !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(token))) return false;
      const fields = Object.getOwnPropertyDescriptors(token);
      if (Reflect.ownKeys(fields).length !== 2 || fields.runId?.value !== current.runId || fields.generation?.value !== current.generation) return false;
      return this.recorder.append('provider_receipt', payload as CausalPayloads['provider_receipt']);
    } catch { return false; }
  }
  start() {
    this.rotate();
    const started = !this.closed && this.recorder.start({ runId: crypto.randomUUID(), mode: this.mode });
    this.captureActive = started; this.refresh(); return started;
  }
  stop() { this.rotate(); this.captureActive = false; this.recorder.stop(); this.refresh(); }
  clear() { this.rotate(); this.captureActive = false; this.recorder.clear(); this.refresh(); }
  tick() { this.recorder.tick(); this.refresh(); }
  snapshot() { this.activeState(); return this.recorder.snapshot(); }
  dispose() { this.closed = true; this.clear(); }
  private refresh() {
    const state = this.activeState(), active = state?.active === true;
    element<HTMLButtonElement>('trace-start').disabled = this.closed || active;
    element<HTMLButtonElement>('trace-stop').disabled = !active;
    element<HTMLButtonElement>('trace-export').disabled = !state?.recordCount;
    element<HTMLButtonElement>('trace-clear').disabled = !state;
    const label = !state ? 'Chưa ghi.' : state.ended === 'expired' ? 'Đã xóa bản ghi hết hạn.'
      : `${active ? 'Đang ghi' : 'Đã dừng'} · ${Math.ceil(state.storedBytes / 1024)} KiB${state.incomplete ? ' · bản ghi chưa đầy đủ' : ''}.`;
    element('trace-status').textContent = label;
  }
  private download() {
    const bundle = this.recorder.snapshot();
    if (!bundle.manifest?.recordCount) { this.refresh(); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `fisch-causal-${bundle.manifest.runId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
