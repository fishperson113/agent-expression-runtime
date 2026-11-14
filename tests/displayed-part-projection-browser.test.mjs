import {expect,it} from 'vitest';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
it('projects submitted browser particles, resize frames and movement; hides lost/disposed output',async()=>{
 const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();let browser;
 try {
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
  const result=await page.evaluate(`(async()=>{
   const {ThreeRenderer}=await import('/src/adapters/three-renderer.ts');
   const {initialState}=await import('/src/core/runtime/scheduler.ts');
   const THREE=await import('/node_modules/three/build/three.module.js');
   const canvas=document.createElement('canvas');document.body.append(canvas);const r=new ThreeRenderer(canvas,()=>{});r.resize(320,240,1);r.quality(4);
   const empty=r.projectDisplayedParts();
   const state={...initialState(),flowStrength:0,dispersion:0,particlePositions:new Float32Array([-.2,0,0,.2,0,0,.1,.2,0,-.1,.2,0]),particleGroups:new Uint8Array([0,0,1,1]),particleParts:[{id:'base',kind:'ellipsoid',center:[0,0,0],scale:[.1,.1,.1]},{id:'top',kind:'ellipsoid',center:[0,.2,0],scale:[.1,.1,.1]}]};
   r.apply(state,1000);const first=r.projectDisplayedParts();
   const expected=new THREE.Vector3(r.positions[0],r.positions[1],r.positions[2]).applyMatrix4(r.points.matrixWorld).project(r.camera);
   const expected2=new THREE.Vector3(r.positions[3],r.positions[4],r.positions[5]).applyMatrix4(r.points.matrixWorld).project(r.camera);
   const actualMean=((expected.x+1)/2+(expected2.x+1)/2)/2;
   r.resize(600,240,1);const resized=r.projectDisplayedParts();
   r.apply({...state,rise:.6},1600);const moved=r.projectDisplayedParts();
   canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));const lost=r.projectDisplayedParts();
   canvas.dispatchEvent(new Event('webglcontextrestored'));const restoredBeforeRender=r.projectDisplayedParts();
   const render=r.renderer.render;r.renderer.render=()=>{throw Error('test_render_failure');};
   try{r.apply(state,1700);}catch{}const failedRedraw=r.projectDisplayedParts();r.renderer.render=render;
   r.apply(state,1800);const recovered=r.projectDisplayedParts();
   r.dispose();const disposed=r.projectDisplayedParts();
   return {empty,first,actualMean,resized,moved,lost,restoredBeforeRender,failedRedraw,recovered,disposed};
  })()`);
  expect(result.empty).toBeNull();expect(result.first.parts[0].centroid.x).toBeCloseTo(result.actualMean);
  expect(result.resized.frameId).toBeGreaterThan(result.first.frameId);expect(result.resized.contentFrame).toBe(result.first.contentFrame);expect(result.resized.viewport.width).toBe(600);
  expect(result.moved.contentFrame).toBeGreaterThan(result.first.contentFrame);expect(result.moved.parts[0].centroid.y).toBeLessThan(result.first.parts[0].centroid.y);
  expect(result.lost).toBeNull();expect(result.restoredBeforeRender).toBeNull();expect(result.failedRedraw).toBeNull();
  expect(result.recovered.frameId).toBeGreaterThan(result.moved.frameId);expect(result.recovered.contentFrame).toBeGreaterThan(result.moved.contentFrame);
  expect(result.disposed).toBeNull();
 } finally {await browser?.close();await server.close();}
},30000);
