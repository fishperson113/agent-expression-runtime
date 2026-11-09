import { FaceLandmarker, FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import { selectVisionDelegate } from './vision-delegate';

let hands: GestureRecognizer | undefined, handsFailed = false;
let landmarker: FaceLandmarker | undefined, delegate = 'GPU';
async function initialize(preferred: 'GPU' | 'CPU' = 'GPU', enableHands = false) {
  const selected = selectVisionDelegate(preferred); delegate = selected;
  const files = await FilesetResolver.forVisionTasks('/live-assets/wasm', true);
  const response = await fetch(files.wasmLoaderPath);
  if (!response.ok) throw Error('vision_loader_unavailable');
  const source = await response.text();
  const loader = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  files.wasmLoaderPath = loader;
  const options = { baseOptions: { modelAssetPath: '/live-assets/face_landmarker.task', delegate: selected },
    runningMode: 'VIDEO' as const, numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true };
  try {
    try { landmarker = await FaceLandmarker.createFromOptions(files, options); }
    catch { delegate = 'CPU'; options.baseOptions.delegate = 'CPU'; landmarker = await FaceLandmarker.createFromOptions(files, options); }
    if (enableHands) {
      const handLoader = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try { hands = await GestureRecognizer.createFromOptions({ ...files, wasmLoaderPath: handLoader }, { baseOptions: { modelAssetPath: '/live-assets/gesture_recognizer.task', delegate: selected },
        runningMode: 'VIDEO', numHands: 2 }); } catch { handsFailed = true; } finally { URL.revokeObjectURL(handLoader); }
    }
  } finally { URL.revokeObjectURL(loader); }
  self.postMessage({ type: 'ready', delegate });
}
function detect(frame: ImageBitmap, at: number) {
  try {
    const start = performance.now(), result = landmarker!.detectForVideo(frame, at);
    let categories: { categoryName: string; score: number }[] = [];
    try { categories = hands?.recognizeForVideo(frame, at).gestures.map(items => items[0]).filter(Boolean) ?? []; }
    catch { handsFailed = true; hands?.close(); hands = undefined; }
    self.postMessage({ type: 'sample', sample: { hands: categories, handsFailed, landmarks: result.faceLandmarks[0] ?? [],
      scores: Object.fromEntries((result.faceBlendshapes[0]?.categories ?? []).map(item => [item.categoryName, item.score])),
      matrix: result.facialTransformationMatrixes[0]?.data ?? [], durationMs: performance.now() - start, delegate } });
  } finally { frame.close(); }
}
self.onmessage = async event => {
  try {
    if (event.data.type === 'init') await initialize(event.data.delegate === 'CPU' ? 'CPU' : 'GPU', event.data.hands === true);
    if (event.data.type === 'frame' && landmarker) detect(event.data.frame, event.data.at);
    if (event.data.type === 'stop') { landmarker?.close(); hands?.close(); self.close(); }
  } catch (error) { self.postMessage({ type: 'error', code: error instanceof Error ? error.message : 'vision_failed' }); }
};
