import { CausalRecorder } from '../core/live/causal-recorder';
import type { CausalKind, CausalPayloads } from '../core/live/causal-recorder-types';
import { element } from './view';

export class LiveRecording {
  private recorder: CausalRecorder;
  private closed = false;
  constructor(epoch: () => string, private mode: 'synthetic' | 'live-structured') {
    this.recorder = new CausalRecorder({ now: () => performance.now(), wallNow: () => Date.now(), epoch });
    element('trace-start').onclick = () => this.start();
    element('trace-stop').onclick = () => this.stop();
    element('trace-clear').onclick = () => this.clear();
    element('trace-export').onclick = () => this.download();
    this.refresh();
  }
  record = <K extends CausalKind>(kind: K, payload: CausalPayloads[K]) => { this.recorder.append(kind, payload); };
  start() {
    const started = !this.closed && this.recorder.start({ runId: crypto.randomUUID(), mode: this.mode });
    this.refresh(); return started;
  }
  stop() { this.recorder.stop(); this.refresh(); }
  clear() { this.recorder.clear(); this.refresh(); }
  tick() { this.recorder.tick(); this.refresh(); }
  snapshot() { return this.recorder.snapshot(); }
  dispose() { this.closed = true; this.clear(); }
  private refresh() {
    const state = this.recorder.status(), active = state?.active === true;
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
