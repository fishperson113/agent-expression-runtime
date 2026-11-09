import './style.css';
import { mountLive, element } from './view';
import { HandGestures } from './gestures';
import { LiveBody } from './body';
import { FaceObservations, type FaceSample } from './observation';
import { VisionCamera } from './vision';
import { LiveBridge } from './bridge';
import type { LiveEventKind } from '../core/live/types';
import { drawLandmarkOverlay } from './landmark-overlay';

mountLive(element('app'));
const synthetic = new URLSearchParams(location.search).get('fixture') === 'synthetic';
const body = new LiveBody(element<HTMLCanvasElement>('body'), text => { element('body-status').textContent = text; });
const hands = new HandGestures();
const observations = new FaceObservations(crypto.randomUUID());
const cameraTransitions: { status: string; source: string; at: number }[] = [];
const bridge = new LiveBridge(body, observations);
let lastActivity = 'idle';
let semanticSequence = 0, semanticGeneration = 0;
const semanticEvents: { type: LiveEventKind; at: number; seq: number }[] = [];
const activityLog: { text: string; at: number }[] = [];
function logActivity(text: string) {
  if (typeof text !== 'string' || !text.trim() || stopped) return;
  activityLog.unshift({ text: text.slice(0, 160), at: Date.now() }); activityLog.splice(40);
  element('agent-activity').replaceChildren(...activityLog.map(event => {
    const item = document.createElement('li');
    item.textContent = new Date(event.at).toLocaleTimeString('vi-VN') + ' / ' + event.text;
    return item;
  }));
}
type ChatSnapshot = { generation: number; revision: number; available: boolean; canSend: boolean; canCancel: boolean;
  pending: boolean; stopping: boolean; waiting: boolean; error: string;
  messages: { id: string; turn: string; role: string; text: string; status: string; truncated: boolean }[] };
let chatState: ChatSnapshot | undefined, chatSignature = '', chatSubmitting = false;
function showChat(value: ChatSnapshot) {
  chatState = value;
  const signature = JSON.stringify([value.revision, value.canSend, value.canCancel, value.waiting, value.available, chatSubmitting]);
  if (signature === chatSignature || stopped) return;
  chatSignature = signature;
  const list = element('chat-messages'), bottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
  const existing = new Map([...list.children].map(node => [(node as HTMLElement).dataset.key, node]));
  const nodes = value.messages.map(message => {
    const key = message.turn + ':' + message.id, item = existing.get(key) ?? document.createElement('li');
    (item as HTMLElement).dataset.key = key; (item as HTMLElement).dataset.role = message.role;
    const text = (message.role === 'user' ? 'Bạn: ' : 'Fisch: ') + message.text +
      (message.truncated ? '\n[Đã rút gọn phần hiển thị]' : '') + (message.status === 'interrupted' ? '\n[Đã ngắt]' : message.status === 'failed' ? '\n[Lượt bị lỗi]' : '');
    if (item.textContent !== text) item.textContent = text;
    return item;
  });
  list.replaceChildren(...nodes); if (bottom) list.scrollTop = list.scrollHeight;
  element<HTMLTextAreaElement>('chat-input').disabled = !value.available;
  element<HTMLButtonElement>('chat-send').disabled = !value.canSend || chatSubmitting;
  element<HTMLButtonElement>('chat-stop').disabled = !value.canCancel;
  element('chat-status').textContent = value.error || (value.waiting ? 'Codex cần bạn xác nhận trong terminal.' :
    value.stopping ? 'Đang dừng trả lời…' : value.pending || chatSubmitting ? 'Đang gửi…' : !value.available ? 'Chat cần phiên terminal Live kết nối.' :
      !value.canSend ? 'Fisch đang phản hồi. Bạn có thể dừng trả lời.' : 'Fisch đang ở đây. Bạn có thể nhắn khi cần.');
}
async function chatAction(action: 'send' | 'cancel') {
  if (!chatState || stopped || (action === 'send' && (chatSubmitting || !chatState.canSend))) return;
  const input = element<HTMLTextAreaElement>('chat-input'), text = input.value, generation = chatState.generation;
  if (action === 'send' && !text.trim()) return;
  chatSubmitting = action === 'send'; showChat(chatState);
  try {
    await (window as any).fischLiveChat({ action, text, generation });
    if (action === 'send' && input.value === text && chatState.generation === generation) input.value = '';
  } catch (error) { element('chat-status').textContent = error instanceof Error ? error.message : 'Không gửi được. Kiểm tra terminal.'; }
  finally { chatSubmitting = false; chatSignature = ''; }
}
element<HTMLFormElement>('chat-form').onsubmit = event => { event.preventDefault(); void chatAction('send'); };
element('chat-stop').onclick = () => { void chatAction('cancel'); };
Object.assign(window, { fischLive: { pair: (base: string, token: string) => bridge.connect(base, token),
  selectThread: () => { hands.reset(); semanticGeneration++; semanticEvents.length = 0; logActivity('Đã chọn phiên Codex.'); return bridge.cancel(); },
  logActivity, chat: showChat,
  reactivity: () => ({ sessionId: observations.snapshot.sessionId + ':' + semanticGeneration, enabled: element<HTMLInputElement>('enable-reactivity').checked, stopped,
    camera: observations.snapshot.camera, capturedAt: observations.snapshot.capturedAt, events: [...semanticEvents] }),
  activity: (value: { turn: 'idle' | 'working' | 'waiting' | 'interrupted'; output: number; quality: string }) => {
    if (stopped) return;
    const reactiveAvailable = value.quality === 'codex-agent-message-delta';
    element<HTMLInputElement>('enable-reactivity').disabled = !reactiveAvailable;
    element('reactivity-status').textContent = reactiveAvailable ? 'Codex đã kết nối; phản ứng camera là tùy chọn.' : 'Phản ứng Codex cần phiên terminal Live kết nối.';
    if (!reactiveAvailable) element<HTMLInputElement>('enable-reactivity').checked = false;
    if (value.turn === 'interrupted' && lastActivity !== 'interrupted') { hands.reset(); void bridge.cancel(); }
    if (lastActivity !== value.turn) logActivity(({ idle: 'Lượt Codex đã kết thúc.', working: 'Codex bắt đầu xử lý.',
      waiting: 'Codex đang chờ bạn.', interrupted: 'Lượt Codex đã bị ngắt.' })[value.turn]);
    lastActivity = value.turn;
    body.output = value.output; body.activity(value.turn); events(observations.turn(value.turn, Date.now()));
    element('activity').textContent = ({ idle: 'Đang chờ', working: value.output > 0 ? 'Đang trả lời' : 'Đang xử lý', waiting: 'Chờ bạn', interrupted: 'Đã ngắt' })[value.turn];
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
  for (const event of values) {
    recent.unshift(event); body.event(event.type);
    if (['user_arrived', 'user_left', 'looked_away', 'looked_back', 'expression_changed'].includes(event.type)) {
      semanticEvents.push({ ...event, seq: ++semanticSequence }); semanticEvents.splice(0, Math.max(0, semanticEvents.length - 20));
      logActivity('Quan sát local: ' + event.type);
    }
  }
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
  if (camera.hands) {
    const now = performance.now(); hands.update(value.hands ?? [], now);
    const gesture = hands.label(now);
    const text = value.handsFailed ? 'Không tải được nhận diện tay; khuôn mặt vẫn chạy.' : gesture ? 'Cử chỉ: ' + gesture : 'Tay: đang theo dõi tại máy';
    if (element('hand-status').textContent !== text) element('hand-status').textContent = text;
    observations.snapshot.summary += ' Tay: ' + (value.handsFailed ? 'chưa sẵn sàng.' : gesture ? gesture + ' (ước lượng tư thế, không suy ý định).' : 'chưa có cử chỉ ổn định.');
  }
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
  if (!status.startsWith('ready-')) semanticEvents.length = 0;
  logActivity('Camera: ' + status);
  cameraTransitions.push({ status, source, at: Date.now() }); cameraTransitions.splice(0, Math.max(0, cameraTransitions.length - 20));
  const messages: Record<string, string> = { starting: 'Đang khởi tạo camera…', denied: 'Chưa có quyền camera', camera_failed: 'Không mở được camera',
    vision_failed: 'Không chạy được thị giác', vision_timeout: 'Thị giác khởi tạo quá lâu', stopped: 'Camera đang tắt', 'recovering-CPU': 'Đang chuyển thị giác sang CPU…' };
  element('camera-status').textContent = messages[status] ?? (status.startsWith('ready-') ? `Camera sẵn sàng / ${status.replace('ready-', '')}` : `Camera lỗi: ${status}`);
  const active = status === 'starting' || status.startsWith('ready-') || status === 'recovering-CPU';
  element<HTMLButtonElement>('camera-start').disabled = active || synthetic;
  element<HTMLButtonElement>('camera-stop').disabled = !active;
  element<HTMLInputElement>('enable-hands').disabled = active || synthetic;
  if (!status.startsWith('ready-')) hands.reset();
  if (!active) { hands.reset(); element('hand-status').textContent = 'Cử chỉ tay đang tắt'; }
  element('camera-placeholder').hidden = active;
  if (!status.startsWith('ready-')) { observations.status(status === 'starting' || status === 'recovering-CPU' ? 'starting' : status === 'denied' ? 'denied' : status === 'stopped' ? 'stopped' : 'error', Date.now()); body.observe(observations.snapshot); }
}
element('enable-reactivity').onchange = () => {
  semanticEvents.length = 0;
  logActivity(element<HTMLInputElement>('enable-reactivity').checked ? 'Đã bật phản ứng Codex từ quan sát local.' : 'Đã tắt phản ứng Codex từ camera.');
};
element('enable-hands').onchange = () => { camera.hands = element<HTMLInputElement>('enable-hands').checked; hands.reset(); };
element('fullscreen').onclick = () => { void element('body').parentElement!.requestFullscreen().catch(() => { element('fault').textContent = 'Trình duyệt chưa cho phép toàn màn hình.'; }); };
element('camera-start').onclick = () => { sampleCount = 0; sampleAt = performance.now(); inferenceMs = 0; void camera.start(); };
if (synthetic) {
  element<HTMLButtonElement>('camera-start').disabled = true;
  element<HTMLInputElement>('enable-hands').disabled = true;
  element('camera-placeholder').textContent = 'Fixture tổng hợp. Không mở camera hoặc microphone.';
  element('camera-status').textContent = 'Dữ liệu tổng hợp / không camera';
}
element('camera-stop').onclick = () => { camera.stop(); cameraStatus('stopped', 'button'); };
element('cancel').onclick = () => { hands.reset(); semanticGeneration++; semanticEvents.length = 0; logActivity('Đã dừng biểu đạt.'); void bridge.cancel(); };
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
  if (stopped) return; logActivity('Đã dừng phiên Live.'); stopped = true; semanticEvents.length = 0;
  element<HTMLTextAreaElement>('chat-input').disabled = true;
  element<HTMLButtonElement>('chat-send').disabled = true; element<HTMLButtonElement>('chat-stop').disabled = true;
  camera.stop(); hands.reset(); cameraStatus('stopped', 'shutdown'); clearInterval(timer); bridge.stop(); body.dispose();
  element<HTMLButtonElement>('camera-start').disabled = true; element('connection').textContent = 'Đã dừng phiên Live';
  void (window as any).fischLiveStop?.();
}
element('stop-all').onclick = stop;
window.addEventListener('pagehide', stop);
