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
