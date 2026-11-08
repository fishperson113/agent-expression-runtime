import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarker: FaceLandmarker | undefined, delegate = 'GPU';
async function initialize(preferred: 'GPU' | 'CPU' = 'GPU') {
  delegate = preferred;
  const files = await FilesetResolver.forVisionTasks('/live-assets/wasm', true);
  const response = await fetch(files.wasmLoaderPath);
  if (!response.ok) throw Error('vision_loader_unavailable');
  const loader = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
  files.wasmLoaderPath = loader;
  const options = { baseOptions: { modelAssetPath: '/live-assets/face_landmarker.task', delegate: preferred },
    runningMode: 'VIDEO' as const, numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true };
  try {
    try { landmarker = await FaceLandmarker.createFromOptions(files, options); }
    catch { delegate = 'CPU'; options.baseOptions.delegate = 'CPU'; landmarker = await FaceLandmarker.createFromOptions(files, options); }
  } finally { URL.revokeObjectURL(loader); }
  self.postMessage({ type: 'ready', delegate });
}
function detect(frame: ImageBitmap, at: number) {
  try {
    const start = performance.now(), result = landmarker!.detectForVideo(frame, at);
    self.postMessage({ type: 'sample', sample: { landmarks: result.faceLandmarks[0] ?? [],
      scores: Object.fromEntries((result.faceBlendshapes[0]?.categories ?? []).map(item => [item.categoryName, item.score])),
      matrix: result.facialTransformationMatrixes[0]?.data ?? [], durationMs: performance.now() - start, delegate } });
  } finally { frame.close(); }
}
self.onmessage = async event => {
  try {
    if (event.data.type === 'init') await initialize(event.data.delegate === 'CPU' ? 'CPU' : 'GPU');
    if (event.data.type === 'frame' && landmarker) detect(event.data.frame, event.data.at);
    if (event.data.type === 'stop') { landmarker?.close(); self.close(); }
  } catch (error) { self.postMessage({ type: 'error', code: error instanceof Error ? error.message : 'vision_failed' }); }
};
