import './style.css';
import { mountLive, element } from './view';
import { LiveBody } from './body';
import { FaceObservations, type FaceSample } from './observation';
import { VisionCamera } from './vision';
import { LiveBridge } from './bridge';
import type { LiveEventKind } from '../core/live/types';
import { drawLandmarkOverlay } from './landmark-overlay';

mountLive(element('app'));
const synthetic = new URLSearchParams(location.search).get('fixture') === 'synthetic';
const body = new LiveBody(element<HTMLCanvasElement>('body'), text => { element('body-status').textContent = text; });
const observations = new FaceObservations(crypto.randomUUID());
const cameraTransitions: { status: string; source: string; at: number }[] = [];
const bridge = new LiveBridge(body, observations);
let lastActivity = 'idle';
Object.assign(window, { fischLive: { pair: (base: string, token: string) => bridge.connect(base, token),
  selectThread: () => bridge.cancel(),
  activity: (value: { turn: 'idle' | 'working' | 'waiting' | 'interrupted'; output: number; quality: string }) => {
    if (stopped) return;
    if (value.turn === 'interrupted' && lastActivity !== 'interrupted') void bridge.cancel();
    lastActivity = value.turn;
    body.output = value.output; body.activity(value.turn); events(observations.turn(value.turn, Date.now()));
    element('activity').textContent = `${value.turn} / nhịp chữ: ${value.quality}`;
  }, fixture: (mode: string) => fixture(mode), metrics: () => ({ ...body.metrics, syntheticFixture: synthetic,
    camera: observations.snapshot.camera, cameraSeq: observations.snapshot.seq,
    cameraStatus: element('camera-status').textContent, cameraActive: !!element<HTMLVideoElement>('camera').srcObject,
    cameraTransitions, stopped,
    simulatedParticles: body.scheduler.state.particlePositions?.length ? body.scheduler.state.particlePositions.length / 3 : 2000 }), event: (type: string) => {
    const turn = type === 'user_message' ? 'working' : type === 'needs_user' ? 'waiting' : type === 'interrupted' ? 'interrupted' : 'idle';
    body.activity(turn); events(observations.turn(turn, Date.now()));
    if (type === 'interrupted') void bridge.cancel();
  } } });
const recent: { type: LiveEventKind; at: number }[] = [];
let sampleCount = 0, sampleAt = performance.now(), inferenceMs = 0, stopped = false;
const camera = new VisionCamera(element<HTMLVideoElement>('camera'), sample, cameraStatus,
  new URLSearchParams(location.search).get('vision') === 'cpu' ? 'CPU' : 'GPU');

function events(values: { type: LiveEventKind; at: number }[]) {
  bridge.events(values);
  for (const event of values) { recent.unshift(event); body.event(event.type); }
  recent.splice(20);
  element('events').replaceChildren(...recent.map(event => { const item = document.createElement('li');
    item.textContent = new Date(event.at).toLocaleTimeString('vi-VN') + ' / ' + event.type; return item; }));
}
function sample(value: FaceSample) {
  sampleCount++; inferenceMs += value.durationMs;
  events(observations.update(value, Date.now())); body.observe(observations.snapshot);
  const elapsed = (performance.now() - sampleAt) / 1000;
  element('vision-metrics').textContent = `${value.delegate} / ${(sampleCount / elapsed).toFixed(1)} mẫu/s / ${(inferenceMs / sampleCount).toFixed(0)} ms inference`;
  element('summary').textContent = observations.snapshot.summary;
  drawLandmarks(value);
}
function drawLandmarks(value: FaceSample) {
  drawLandmarkOverlay(element<HTMLCanvasElement>('landmarks'), value.landmarks, element<HTMLInputElement>('show-landmarks').checked);
}
function fixture(mode: string) {
  if (!synthetic || stopped || !['present', 'absent', 'denied', 'error', 'stale'].includes(mode)) throw Error('synthetic_fixture_unavailable');
  if (mode === 'present' || mode === 'absent') sample({
    landmarks: mode === 'present' ? Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })) : [],
    scores: { mouthSmileLeft: 0.4, mouthSmileRight: 0.4 }, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    durationMs: 0, delegate: 'SYNTHETIC / no inference' });
  else { observations.status(mode as 'denied' | 'error' | 'stale', Date.now() - (mode === 'stale' ? 2000 : 0)); body.observe(observations.snapshot); }
  element('camera-status').textContent = 'Dữ liệu tổng hợp / không camera';
}
function cameraStatus(status: string, source = 'vision') {
  cameraTransitions.push({ status, source, at: Date.now() }); cameraTransitions.splice(0, Math.max(0, cameraTransitions.length - 20));
  const messages: Record<string, string> = { starting: 'Đang khởi tạo camera…', denied: 'Chưa có quyền camera', camera_failed: 'Không mở được camera',
    vision_failed: 'Không chạy được thị giác', vision_timeout: 'Thị giác khởi tạo quá lâu', stopped: 'Camera đang tắt', 'recovering-CPU': 'Đang chuyển thị giác sang CPU…' };
  element('camera-status').textContent = messages[status] ?? (status.startsWith('ready-') ? `Camera sẵn sàng / ${status.replace('ready-', '')}` : `Camera lỗi: ${status}`);
  const active = status === 'starting' || status.startsWith('ready-') || status === 'recovering-CPU';
  element<HTMLButtonElement>('camera-start').disabled = active || synthetic;
  element<HTMLButtonElement>('camera-stop').disabled = !active;
  element('camera-placeholder').hidden = active;
  if (!status.startsWith('ready-')) { observations.status(status === 'starting' || status === 'recovering-CPU' ? 'starting' : status === 'denied' ? 'denied' : status === 'stopped' ? 'stopped' : 'error', Date.now()); body.observe(observations.snapshot); }
}
element('camera-start').onclick = () => { sampleCount = 0; sampleAt = performance.now(); inferenceMs = 0; void camera.start(); };
if (synthetic) {
  element<HTMLButtonElement>('camera-start').disabled = true;
  element('camera-placeholder').textContent = 'Fixture tổng hợp. Không mở camera hoặc microphone.';
  element('camera-status').textContent = 'Dữ liệu tổng hợp / không camera';
}
element('camera-stop').onclick = () => { camera.stop(); cameraStatus('stopped', 'button'); };
element('cancel').onclick = () => { void bridge.cancel(); };
element<HTMLSelectElement>('motion').value = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'normal';
element('motion').onchange = () => body.motion(element<HTMLSelectElement>('motion').value as 'normal' | 'reduced' | 'off');
body.motion(element<HTMLSelectElement>('motion').value as 'normal' | 'reduced');
const timer = setInterval(() => {
  element('world-state').textContent = JSON.stringify(observations.snapshot, null, 2);
  const metrics = body.metrics;
  element('scene-trace').textContent = JSON.stringify(metrics.diagnostics, null, 2);
  element('render-metrics').textContent = `${metrics.particles.toLocaleString()} hạt / ${metrics.meanFps.toFixed(0)} FPS / p95 ${metrics.frameP95.toFixed(1)} ms`;
}, 500);
function stop() {
  if (stopped) return; stopped = true;
  camera.stop(); cameraStatus('stopped', 'shutdown'); clearInterval(timer); bridge.stop(); body.dispose();
  element<HTMLButtonElement>('camera-start').disabled = true; element('connection').textContent = 'Đã dừng phiên Live';
  void (window as any).fischLiveStop?.();
}
element('stop-all').onclick = stop;
window.addEventListener('pagehide', stop);
