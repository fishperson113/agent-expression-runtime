type Delegate = 'GPU' | 'CPU';

export function selectVisionDelegate(preferred: Delegate, createCanvas = () => new OffscreenCanvas(1, 1)): Delegate {
  if (preferred === 'CPU') return 'CPU';
  let context: WebGL2RenderingContext | null = null;
  try {
    context = createCanvas().getContext('webgl2');
    const info = context?.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? context?.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
    return /swiftshader/i.test(String(renderer)) ? 'CPU' : 'GPU';
  } catch { return 'GPU'; }
  finally {
    try { context?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* Query cleanup must not prevent initialization. */ }
  }
}
