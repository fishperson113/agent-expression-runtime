import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

async function readColors(page) {
  return page.evaluate(`(async () => {
    const { ThreeRenderer } = await import('/src/adapters/three-renderer.ts');
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const renderer = new ThreeRenderer(canvas, () => {}, 42), records = [];
    try {
      renderer.resize(501, 501, 1); renderer.quality(1);
      renderer.camera.position.set(0, 0, 4); renderer.camera.lookAt(0, 0, 0);
      renderer.positions.fill(0); renderer.geometry.attributes.position.needsUpdate = true;
      renderer.material.uniforms.size.value = 51;
      for (const brightness of [1, 0.5, 0]) for (const color of ['#79e6d3', '#ffd49a', '#808080', '#ff0000', '#00ff00', '#0000ff', '#000000', '#ffffff']) {
        renderer.material.uniforms.color.value.set(color);
        renderer.material.uniforms.brightness.value = brightness;
        renderer.renderer.render(renderer.scene, renderer.camera);
        const gl = renderer.renderer.getContext(), pixel = new Uint8Array(4), background = new Uint8Array(4);
        gl.readPixels(250, 250, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, background);
        records.push({ color, brightness, pixel: [...pixel], background: [...background], error: gl.getError() });
      }
      return records;
    } finally { renderer.dispose(); canvas.remove(); }
  })()`);
}

it('renders authored sRGB colors with unchanged zero and half brightness alpha', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.route('**/color-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Color probe</title>' }));
    await page.goto(server.resolvedUrls.local[0] + 'color-probe');
    for (const row of await readColors(page)) {
      expect(row.error).toBe(0);
      const authored = [1, 3, 5].map(i => parseInt(row.color.slice(i, i + 2), 16));
      authored.forEach((value, i) => {
        const expected = Math.round(value * row.brightness + row.background[i] * (1 - row.brightness));
        expect(Math.abs(row.pixel[i] - expected)).toBeLessThanOrEqual(1);
      });
      expect(row.pixel[3]).toBe(255);
      if (row.brightness === 0) expect(row.pixel).toEqual(row.background);
    }
  } finally { await browser?.close(); await server.close(); }
}, 30000);


it('captures only the actual canvas at one submitted frame with bounded image and lifecycle errors',async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
    const output=await page.evaluate(`(async()=>{
      const {ThreeRenderer}=await import('/src/adapters/three-renderer.ts');const {initialState}=await import('/src/core/runtime/scheduler.ts');
      const canvas=document.createElement('canvas');document.body.append(canvas);const r=new ThreeRenderer(canvas,()=>{},42);r.resize(600,400,1);r.quality(500);
      const state={...initialState(),color:'#ff0000',brightness:1,pointSize:5,dispersion:0,flowStrength:0};
      try{
        const pending=r.capturePreview();const busy=await r.capturePreview().catch(e=>e.message);
        r.apply(state,10);const capturedFrame=r.contentFrame;r.apply({...state,color:'#00ff00'},20);const capture=await pending;
        const image=await createImageBitmap(new Blob([Uint8Array.from(atob(capture.image.data),c=>c.charCodeAt(0))],{type:'image/png'}));
        const c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height).data;
        let red=0,green=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>pixels[i+1]+40)red++;if(pixels[i+1]>pixels[i]+40)green++;}
        const timeout=await r.capturePreview().catch(e=>e.message);const disposal=r.capturePreview().catch(e=>e.message);r.dispose();
        return {capture,capturedFrame,busy,timeout,disposed:await disposal,red,green};
      }finally{r.dispose();canvas.remove();}
    })()`);
    expect(output.capture.image.width).toBe(480);expect(output.capture.image.height).toBe(320);expect(output.capture.image.bytes).toBeLessThanOrEqual(163840);
    expect(output.capture.summary.contentFrame).toBe(output.capturedFrame);expect(output.capture.summary.color).toBe('#ff0000');expect(output.red).toBeGreaterThan(50);expect(output.green).toBe(0);
    expect(output.busy).toBe('preview_busy');expect(output.timeout).toBe('preview_timeout');expect(output.disposed).toBe('preview_disposed');
  }finally{await browser?.close();await server.close();}
},30000);

async function readPartColors(page) {
  return page.evaluate(`(async () => {
    const { ThreeRenderer } = await import('/src/adapters/three-renderer.ts');
    const { initialState } = await import('/src/core/runtime/scheduler.ts');
    const { Color } = await import('/node_modules/three/build/three.module.js');
    const canvas = document.createElement('canvas'), r = new ThreeRenderer(canvas, () => {}, 42), records = [];
    try {
      r.resize(501, 501, 1); r.quality(2); r.reducedMotion = true;
      r.camera.position.set(0, 0, 4); r.camera.lookAt(0, 0, 0); r.camera.updateMatrixWorld();
      const x = 200 / 501 * 4 / r.camera.projectionMatrix.elements[0];
      const positions = new Float32Array([-x, 0, 0, x, 0, 0]);
      const colors = ['#79e6d3', '#ffd49a'].map(hex => new Color(hex)), global = new Color('#3040c0');
      for (const weight of [1, 0.5, 0, undefined]) for (const brightness of [1, 0.5, 0]) {
        const overrides = weight === undefined ? undefined : new Float32Array(colors.flatMap(c => [c.r * weight, c.g * weight, c.b * weight, weight]));
        r.apply({ ...initialState(), color: '#3040c0', brightness, pointSize: 51, dispersion: 0, flowStrength: 0, effortFlow: 0,
          particlePositions: positions, particleGroups: new Uint8Array([0, 1]), particleColors: overrides,
          particleParts: [{ id: 'left', kind: 'ellipsoid', color: '#79e6d3' }, { id: 'right', kind: 'ellipsoid', color: '#ffd49a' }] }, 4500);
        const gl = r.renderer.getContext(), background = new Uint8Array(4), pixels = [];
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, background);
        for (const px of [150, 350]) { const pixel = new Uint8Array(4); gl.readPixels(px, 250, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); pixels.push([...pixel]); }
        const expected = colors.map(c => c.clone().multiplyScalar(weight ?? 0).add(global.clone().multiplyScalar(1 - (weight ?? 0))).convertLinearToSRGB())
          .map(c => [c.r, c.g, c.b].map((v, i) => Math.round(v * 255 * brightness + background[i] * (1 - brightness))));
        records.push({ weight: weight ?? 'absent', brightness, pixels, expected, background: [...background], error: gl.getError(), summary: r.inspectOutput() });
      }
      return records;
    } finally { r.dispose(); }
  })()`);
}

it('renders contrasting per-part overrides, fades to global color and preserves brightness alpha', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
      args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.route('**/part-color-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto(server.resolvedUrls.local[0] + 'part-color-probe');
    const records = await readPartColors(page);
    for (const row of records) {
      expect(row.error).toBe(0); expect(row.summary.parts.map(p => p.color)).toEqual(['#79e6d3', '#ffd49a']);
      row.pixels.forEach((pixel, p) => row.expected[p].forEach((value, c) => expect(Math.abs(pixel[c] - value)).toBeLessThanOrEqual(2)));
      if (row.brightness === 0) row.pixels.forEach(pixel => expect(pixel).toEqual(row.background));
    }
    expect(new Set(records.filter(r => r.brightness === 1 && r.weight !== 'absent').map(r => r.summary.signature)).size).toBe(3);
    expect(records.find(r => r.weight === 0 && r.brightness === 1).pixels).toEqual(records.find(r => r.weight === 'absent' && r.brightness === 1).pixels);
  } finally { await browser?.close(); await server.close(); }
}, 30000);
