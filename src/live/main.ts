import type { ReactiveRequest } from '../core/live/decision-types';
import './style.css';
import { mountLive, element, mountDisclosures } from './view';
import { mountPlayground } from './playground-view';
import { mountConversation } from './conversation-view';
import { mountLiveSetup } from './setup-help';
import { HandGestures } from './gestures';
import { LiveBody } from './body';
import { FaceObservations, type FaceSample } from './observation';
import { VisionCamera } from './vision';
import { LiveBridge } from './bridge';
import { eventKinds } from '../core/live/observation';
import { HandEventSource } from './hand-event-source';
import type { SessionEvent } from '../core/live/reactive-session-types';
import type { LiveEventKind, LiveSourceEvent } from '../core/live/types';
import { ReactiveSession } from '../core/live/reactive-session';
import { drawLandmarkOverlay } from './landmark-overlay';
import { LiveRecording } from './recording';

mountLive(element('app'));
const playgroundContainer = element('playground-tools');
const playground = mountPlayground(playgroundContainer);
const setupContainer = element('setup-tools');
const liveSetup = mountLiveSetup(setupContainer);
const conversation = mountConversation(element('conversation-tools'), value => (window as any).fischLiveConversation(value));
mountDisclosures(element('app'));
const synthetic = new URLSearchParams(location.search).get('fixture') === 'synthetic';
const body = new LiveBody(element<HTMLCanvasElement>('body'), text => { element('body-status').textContent = text; });
const recording = new LiveRecording(() => body.scheduler.epoch, synthetic ? 'synthetic' : 'live-structured');
body.trace.setSink(recording.record);
const hands = new HandGestures();
const observations = new FaceObservations(crypto.randomUUID());
const handEvents = new HandEventSource(() => performance.now());
let handEventVersion = 0, reactiveAvailable = false, nativeConversation = false;
const nativeReplies = new Map<string, { text: string; published: boolean }>();
const nativeRequests = new Map<string, { request: ReactiveRequest; read: ReturnType<ReactiveSession['nativeReadSet']> }>();
const cameraTransitions: { status: string; source: string; at: number }[] = [];
const bridge = new LiveBridge(body, observations, () => resetReactive(), () => observeReactive());
const reactive = new ReactiveSession({ now: () => performance.now(), wallNow: () => Date.now(), epoch: () => body.scheduler.epoch,
  id: () => crypto.randomUUID(), canAdmit: () => !document.hidden && body.canReactive(),
  admit: (compiled, owner) => {
    body.admitReactive(compiled, owner);
    const pending = nativeReplies.get(owner.requestId);
    if (pending?.text.trim()) { pending.published = conversation.reaction({ requestId: owner.requestId, text: pending.text }); if (!pending.published) throw Error('reaction_ui_unavailable'); }
  }, cancel: (owner, reason) => body.cancelReactive(owner, reason), record: recording.record, handState: () => handEvents.handState(), handMotion: () => handEvents.handMotion() });
body.attachReactive(reactive);
let lastActivity = 'idle';
const semanticEvents: SessionEvent[] = [];
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
Object.assign(window, { fischLive: { pair: (base: string, token: string) => bridge.connect(base, token),
  selectThread: () => { hands.reset(); resetReactive(); logActivity('Đã chọn phiên Codex.'); return bridge.cancel(); },
  logActivity, playgroundStatus: (value: unknown) => playground.project(value), playgroundClear: () => playground.clear(),
  configureReactive: (available: boolean, handVersion = 0, contractVersion = 1, native = false, policy?: { deadlineMs: number; cooldownMs: number; maxPerMinute: number }) => configureReactive(available, handVersion, contractVersion, native, policy),
  setReactiveUserBusy: (busy: boolean) => reactive.setUserBusy(busy),
  reactiveUserIntent: () => { semanticEvents.length = 0; body.prepareUserMutation(); },
  takeReactiveRequest: () => { const candidate = reactive.takeRequest();
    if (candidate && nativeConversation) { nativeRequests.set(candidate.request.requestId, { request: candidate.request, read: reactive.nativeReadSet(candidate.observationWindow.events) }); if (nativeRequests.size > 8) nativeRequests.delete(nativeRequests.keys().next().value!); }
    return candidate; },
  canContinueNativeReaction: (id: string) => { const held = nativeRequests.get(id); return !!held && reactive.canPublish(held.request, held.read); },
  deliverNativeReaction: async (id: string, data: any) => {
    const held = nativeRequests.get(id); nativeRequests.delete(id);
    if (data !== null && (typeof data?.reply !== 'string' || data.reply.length > 600)) { await reactive.deliver(id, null); return { reason: 'invalid_reply', chatPublished: false }; }
    const pending = { text: data?.reply ?? '', published: false }; nativeReplies.set(id, pending);
    let result; try { result = await reactive.deliver(id, data?.decision ?? null); } finally { nativeReplies.delete(id); }
    const admitted = !!held && !!result && ['accepted', 'observed'].includes(result.reason) && nativeConversation && !stopped && reactive.canPublish(held.request, held.read);
    const chatPublished = pending.published || (admitted && result?.reason === 'observed' && pending.text.trim() ? conversation.reaction({ requestId: id, text: pending.text }) : false);
    return { ...result, chatPublished, source: 'native-observation' };
  }, authorizeReactiveRequest: (id: string) => reactive.authorize(id),
  deliverReactiveDecision: (id: string, data: unknown) => reactive.deliver(id, data), failReactiveDecision: (id: string) => reactive.fail(id),
  reactiveStatus: () => reactive.status(),
  startRecording: () => recording.start(), stopRecording: () => recording.stop(), clearRecording: () => recording.clear(),
  recordingSnapshot: () => recording.snapshot(), recordingCaptureToken: () => recording.captureToken(),
  recordProviderReceipt: (token: unknown, payload: unknown) => recording.providerReceipt(token, payload),
  reactivity: () => ({ sessionId: 'legacy-reactivity-disabled', enabled: false, stopped: true,
    camera: 'stopped', capturedAt: Date.now(), events: [] }),
  activity: (value: { turn: 'idle' | 'working' | 'waiting' | 'interrupted'; output: number; quality: string }) => {
    if (stopped) return;
    if (value.turn === 'interrupted' && lastActivity !== 'interrupted') { hands.reset(); void bridge.cancel(); }
    if (lastActivity !== value.turn) logActivity(({ idle: 'Lượt Codex đã kết thúc.', working: 'Codex bắt đầu xử lý.',
      waiting: 'Codex đang chờ bạn.', interrupted: 'Lượt Codex đã bị ngắt.' })[value.turn]);
    lastActivity = value.turn;
    body.output = value.output; body.activity(value.turn); events(handEvents.publish(observations.turn(value.turn, Date.now())));
    element('activity').textContent = ({ idle: 'Đang chờ', working: value.output > 0 ? 'Đang trả lời' : 'Đang xử lý', waiting: 'Chờ bạn', interrupted: 'Đã ngắt' })[value.turn];
  }, fixture: (mode: string, handX?: number) => fixture(mode, handX), metrics: () => ({ ...body.metrics, syntheticFixture: synthetic,
    camera: observations.snapshot.camera, cameraSeq: observations.snapshot.seq,
    cameraStatus: element('camera-status').textContent, cameraActive: !!element<HTMLVideoElement>('camera').srcObject,
    cameraTransitions, stopped,
    simulatedParticles: body.scheduler.state.particlePositions?.length ? body.scheduler.state.particlePositions.length / 3 : 2000 }), event: (type: string) => {
    if (type === 'user_message') { semanticEvents.length = 0; body.prepareUserMutation(); }
    const turn = type === 'user_message' ? 'working' : type === 'needs_user' ? 'waiting' : type === 'interrupted' ? 'interrupted' : 'idle';
    body.activity(turn); events(handEvents.publish(observations.turn(turn, Date.now())));
    if (type === 'interrupted') void bridge.cancel();
  } } });
Object.assign((window as any).fischLive, { setupStatus: (value: unknown) => liveSetup.project(value),
  conversationStatus: (value: unknown) => { if (!stopped) conversation.project(value); }, conversationClear: () => conversation.clear() });
const recent: LiveSourceEvent[] = [];
let sampleCount = 0, sampleAt = performance.now(), inferenceMs = 0, stopped = false;
const camera = new VisionCamera(element<HTMLVideoElement>('camera'), sample, cameraStatus,
  new URLSearchParams(location.search).get('vision') === 'cpu' ? 'CPU' : 'GPU');

function events(values: LiveSourceEvent[]) {
  bridge.events(values);
  for (const event of values) {
    recent.unshift(event); if (eventKinds.includes(event.type as LiveEventKind)) body.event(event.type as LiveEventKind);
    if ('eventVersion' in event || ['user_arrived', 'user_left', 'looked_away', 'looked_back', 'expression_changed'].includes(event.type)) {
      semanticEvents.push({ ...event, seq: event.sourceSeq! }); semanticEvents.splice(0, Math.max(0, semanticEvents.length - 20));
      logActivity('Quan sát local: ' + event.type);
    }
  }
  observeReactive();
  recent.splice(20);
  element('events').replaceChildren(...recent.map(event => { const item = document.createElement('li');
    item.textContent = new Date(event.at).toLocaleTimeString('vi-VN') + ' / ' + event.type; return item; }));
}
function sample(value: FaceSample) {
  sampleCount++; inferenceMs += value.durationMs;
  const faceEvents = observations.update(value, Date.now());
  events(handEvents.sample(observations.snapshot, faceEvents));
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
function fixture(mode: string, handX = 0.25) {
  if (!synthetic || stopped || !['present', 'present-smile', 'present-neutral', 'present-hand', 'hand-only', 'hand-lost', 'absent', 'denied', 'error', 'stale'].includes(mode) || !Number.isFinite(handX) || handX < 0 || handX > 1) throw Error('synthetic_fixture_unavailable');
  if (mode === 'present' || mode === 'present-smile' || mode === 'present-neutral' || mode === 'present-hand' || mode === 'hand-only' || mode === 'hand-lost' || mode === 'absent') sample({
    ...(mode === 'present-hand' || mode === 'hand-only' || mode === 'hand-lost' ? { handObservation: { v: 1 as const, trackingState: mode === 'hand-lost' ? 'lost' as const : 'tracked' as const, coordinateSpace: 'image-normalized' as const,
      landmarkSchema: 'mediapipe-hand-21' as const, zMeaning: 'wrist-relative-image-width' as const, mirrored: false as const, sourceWidth: 640, sourceHeight: 480,
      entities: mode === 'hand-lost' ? [] : [{ detectionId: 0, handedness: 'Left' as const, confidence: 0.9, landmarks: Array.from({ length: 21 }, () => ({ x: handX, y: 0.5, z: 0 })) }] } } : {}),
    landmarks: mode === 'present' || mode === 'present-smile' || mode === 'present-neutral' || mode === 'present-hand' ? Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })) : [],
    scores: { mouthSmileLeft: mode === 'present-smile' ? 0.9 : mode === 'present-neutral' ? 0.1 : 0.4, mouthSmileRight: mode === 'present-smile' ? 0.9 : mode === 'present-neutral' ? 0.1 : 0.4 }, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    durationMs: 0, delegate: 'SYNTHETIC / no inference' });
  else { handEvents.reset(); observations.status(mode as 'denied' | 'error' | 'stale', Date.now() - (mode === 'stale' ? 2000 : 0)); observeReactive(); }
  element('camera-status').textContent = 'Dữ liệu tổng hợp / không camera';
}
function cameraStatus(status: string, source = 'vision') {
  if (!status.startsWith('ready-')) { semanticEvents.length = 0; handEvents.reset(); }
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
  if (!status.startsWith('ready-')) { observations.status(status === 'starting' || status === 'recovering-CPU' ? 'starting' : status === 'denied' ? 'denied' : status === 'stopped' ? 'stopped' : 'error', Date.now()); observeReactive(); }
  if (!active) recording.stop();
}
element('enable-reactivity').onchange = () => {
  semanticEvents.length = 0; updateHandProducer(); reactive.enable(element<HTMLInputElement>('enable-reactivity').checked); observeReactive();
  logActivity(element<HTMLInputElement>('enable-reactivity').checked ? 'Đã bật bộ quyết định từ quan sát local.' : 'Đã tắt bộ quyết định từ camera.');
};
element('enable-hands').onchange = () => { camera.hands = element<HTMLInputElement>('enable-hands').checked; hands.reset(); };
const fullscreenPanel = element('body').closest<HTMLElement>('.body-panel')!;
const stopHome = element('stop-all').parentElement!;
element('fullscreen').onclick = () => {
  const request = document.fullscreenElement ? document.exitFullscreen() : fullscreenPanel.requestFullscreen();
  void request.catch(() => { element('fault').textContent = 'Trình duyệt chưa cho phép toàn màn hình.'; });
};
document.addEventListener('fullscreenchange', () => {
  const active = document.fullscreenElement === fullscreenPanel, stopButton = element('stop-all');
  element('fullscreen').textContent = active ? 'Thoát toàn màn hình' : 'Toàn màn hình';
  if (!stopButton.closest('dialog[open]')) (active ? fullscreenPanel.querySelector('.body-actions')! : stopHome).append(stopButton);
});
element('camera-start').onclick = () => { sampleCount = 0; sampleAt = performance.now(); inferenceMs = 0; void camera.start(); };
if (synthetic) {
  element<HTMLButtonElement>('camera-start').disabled = true;
  element<HTMLInputElement>('enable-hands').disabled = true;
  element('camera-placeholder').textContent = 'Fixture tổng hợp. Không mở camera hoặc microphone.';
  element('camera-status').textContent = 'Dữ liệu tổng hợp / không camera';
}
element('camera-stop').onclick = () => { camera.stop(); cameraStatus('stopped', 'button'); };
element('cancel').onclick = () => { hands.reset(); resetReactive(); logActivity('Đã dừng biểu đạt.'); void bridge.cancel(); };
element<HTMLSelectElement>('motion').value = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'normal';
element('motion').onchange = () => { if (element<HTMLSelectElement>('motion').value === 'off') resetReactive(); body.motion(element<HTMLSelectElement>('motion').value as 'normal' | 'reduced' | 'off'); };
body.motion(element<HTMLSelectElement>('motion').value as 'normal' | 'reduced');
const timer = setInterval(() => {
  recording.tick();
  element('world-state').textContent = JSON.stringify(observations.snapshot, null, 2);
  const metrics = body.metrics;
  element('scene-trace').textContent = JSON.stringify(metrics.diagnostics, null, 2);
  element('render-metrics').textContent = `${metrics.particles.toLocaleString()} hạt / ${metrics.meanFps.toFixed(0)} FPS / p95 ${metrics.frameP95.toFixed(1)} ms`;
}, 500);
function stop(reason: 'ui' | 'pagehide') {
  if (stopped) return;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  logActivity('Đã dừng phiên Live.'); resetReactive(); reactive.configure(false); stopped = true;
  recording.dispose(); camera.stop(); hands.reset(); cameraStatus('stopped', 'shutdown'); clearInterval(timer); bridge.stop(); body.dispose(); playground.dispose(); liveSetup.dispose(); conversation.dispose();
  element<HTMLButtonElement>('camera-start').disabled = true; element('connection').textContent = 'Đã dừng phiên Live';
  void (window as any).fischLiveStop?.(reason);
}
element('stop-all').onclick = () => stop('ui');
window.addEventListener('pagehide', () => stop('pagehide'));

function observeReactive() { body.observe(observations.snapshot); reactive.observe(observations.snapshot, semanticEvents); }
function resetReactive() { nativeReplies.clear(); nativeRequests.clear(); handEvents.reset(); reactive.reset(); semanticEvents.length = 0; }
function updateHandProducer() { handEvents.configure(reactiveAvailable && handEventVersion === 1 && element<HTMLInputElement>('enable-reactivity').checked); }
function configureReactive(available: boolean, handVersion = 0, contractVersion = 1, native = false, policy?: { deadlineMs: number; cooldownMs: number; maxPerMinute: number }) {
  nativeConversation = native === true; reactive.configureNativeConversation(nativeConversation, policy);
  const knownContract = contractVersion === 1 || contractVersion === 2;
  const enabled = available === true && !stopped && knownContract;
  if (knownContract) reactive.configureContract(contractVersion);
  reactiveAvailable = enabled; handEventVersion = handVersion;
  reactive.configure(enabled); element<HTMLInputElement>('enable-reactivity').disabled = !enabled;
  if (!enabled) element<HTMLInputElement>('enable-reactivity').checked = false;
  updateHandProducer();
  element('reactivity-status').textContent = !enabled ? nativeConversation ? 'Lane chủ động chưa sẵn sàng hoặc kết quả chưa rõ; kiểm tra terminal rồi khởi chạy lại Live. Hội thoại chính vẫn độc lập.' : 'Phản xạ cục bộ dùng tín hiệu hợp lệ; observer ngữ nghĩa chưa kết nối.'
    : body.userSceneOwned ? 'Đang giữ hình bạn tạo; phản ứng tự động tạm nhường quyền.' : nativeConversation ? 'Codex chủ động đã kết nối: dữ liệu hình học có kiểu; không nhận diện cảm xúc/đồ vật. Bật Phản ứng theo camera để bắt đầu.' : 'Bộ quyết định đã kết nối; phản ứng camera là tùy chọn.';
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  resetReactive(); recording.clear(); camera.stop(); cameraStatus('stopped', 'hidden');
});
