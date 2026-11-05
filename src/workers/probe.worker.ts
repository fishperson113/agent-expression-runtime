try {
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2');
  self.postMessage(!!gl);
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
} catch {
  self.postMessage(false);
}
self.close();
