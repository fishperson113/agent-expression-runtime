import * as THREE from 'three';
import type { BodyState, RendererSink } from '../core/ports';
import { MotionPhase } from './motion-phase';
import { capability } from '../primitives/registry';
import { sampleBody, trajectorySceneBounds } from './body-geometry';
import { TargetBoids } from '../core/geometry/boids';
import { particleSignature } from './particle-signature';
import { shapeBuffers } from '../core/geometry/primitives';
export { shapeBuffers } from '../core/geometry/primitives';
export function frameBody(positions: Float32Array, count: number, camera: THREE.PerspectiveCamera, grow = 1, framingMargin = 0.44) {
  camera.updateMatrixWorld();
  const view = camera.matrixWorldInverse.elements, projection = camera.projectionMatrix.elements;
  const distance = -view[14], margin = framingMargin * Math.max(0.25, Math.min(2, grow));
  let fit = 1;
  for (let i = 0; i < count * 3; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const vx = view[0] * x + view[4] * y + view[8] * z;
    const vy = view[1] * x + view[5] * y + view[9] * z;
    const vz = view[2] * x + view[6] * y + view[10] * z;
    const horizontal = Math.abs(projection[0] * vx) + margin * vz;
    const vertical = Math.abs(projection[5] * vy) + margin * vz;
    if (horizontal > 0) fit = Math.min(fit, margin * distance / horizontal);
    if (vertical > 0) fit = Math.min(fit, margin * distance / vertical);
    if (vz > 0) fit = Math.min(fit, (distance - camera.near * 2) / vz);
  }
  if (fit < 1) for (let i = 0; i < count * 3; i++) positions[i] *= fit;
  return fit;
}

export function fitCamera(camera: THREE.PerspectiveCamera, aspect: number) {
  camera.aspect = aspect;
  const halfAngle = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(1, aspect));
  const distance = Math.max(Math.hypot(1.5, 3.8), 1.35 / Math.sin(halfAngle));
  camera.position.set(0, 1.5, 3.8).normalize().multiplyScalar(distance);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
export class ThreeRenderer implements RendererSink {
  private swarm = new TargetBoids();
  private rigid = new Uint8Array(10000);
  private framedParts?: BodyState['particleParts'];
  private trajectoryFit?: number;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private points: THREE.Points;
  private positions = new Float32Array(30000);
  private partColors = new Float32Array(40000);
  private colorSignature = 0;
  private shapes: Float32Array[];
  private color = new THREE.Color();
  private lost = false;
  private restores = 0;
  private orbit = new MotionPhase();
  count = 10000;
  private submittedFrames = 0;
  private disposed = false;
  private preview?: {
    resolve: (value: RendererPreview) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>; copying: boolean;
  };
  reducedMotion = false;
  constructor(
    private canvas: HTMLCanvasElement | OffscreenCanvas,
    private fault: (code: string) => void,
    seed = 42,
  ) {
    this.shapes = shapeBuffers(10000, seed);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x0b1020, 1);
    this.camera.position.set(0, 1.5, 3.8);
    this.camera.lookAt(0, 0, 0);
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute('partColor', new THREE.BufferAttribute(this.partColors, 4).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        color: { value: new THREE.Color('#79e6d3') },
        size: { value: 2 },
        brightness: { value: 0.65 },
        dpr: { value: 1 },
      },
      vertexShader:
        'attribute vec4 partColor; uniform vec3 color; varying vec3 renderedColor; uniform float size; uniform float dpr; void main(){ renderedColor=partColor.xyz+color*(1.0-partColor.w); vec4 p=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*dpr*clamp(3.8/-p.z,0.75,1.25); gl_Position=projectionMatrix*p; }',
      fragmentShader:
        'varying vec3 renderedColor; uniform float brightness; void main(){float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; gl_FragColor=vec4(renderedColor,brightness*(1.0-d*d));\n#include <colorspace_fragment>\n}',
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);
    canvas.addEventListener('webglcontextlost', this.onLost as EventListener);
    canvas.addEventListener('webglcontextrestored', this.onRestore as EventListener);
  }
  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.rejectPreview('preview_context_lost');
    this.fault('context_lost');
  };
  private onRestore = () => {
    if (this.restores++ < 1) {
      this.lost = false;
      this.fault('context_restored');
    } else this.fault('context_recovery_exhausted');
  };
  resize(width: number, height: number, dpr: number) {
    this.renderer.setPixelRatio(Math.min(2, dpr));
    this.renderer.setSize(width, height, false);
    fitCamera(this.camera, Math.max(1, width) / Math.max(1, height));
    this.material.uniforms.dpr.value = Math.min(2, dpr);
    this.framedParts = undefined; this.trajectoryFit = undefined;
    if (!this.lost && this.submittedFrames > 0) {
      this.renderer.render(this.scene, this.camera);
      this.submittedFrames++;
      this.outputAt = Date.now();
    }
  }
  quality(count: number) {
    this.count = count;
    this.geometry.setDrawRange(0, count);
  }
  private outputParts: { id: string; kind: string; color?: string }[] = [];
  private outputGroups = new Uint8Array();
  private outputAt = 0;
  private outputFrame = 0;
  get contentFrame() { return this.outputFrame; }
  apply(state: BodyState, now: number) {
    if (this.lost) return;
    const amp = this.reducedMotion ? 0.08 : 1;
    const angle = this.orbit.advance(now, state.flowStrength * amp * state.flowWeights[capability.fields.indexOf('orbit')]);
    sampleBody(this.shapes, this.positions, this.count, state, now, angle, this.reducedMotion);
    for (let i = 0; i < this.count; i++) this.rigid[i] = state.particleParts?.[state.particleGroups?.[i] ?? -1]?.trajectory ? 1 : 0;
    this.swarm.apply(this.positions, this.count, now, state.particleGroups, !this.reducedMotion, this.rigid);
    this.frameScene(state);
    this.geometry.attributes.position.needsUpdate = true;
    this.updatePartColors(state.particleColors);
    this.material.uniforms.color.value = this.color.set(String(state.color));
    this.material.uniforms.size.value = Number(state.pointSize);
    this.material.uniforms.brightness.value = Number(state.brightness);
    this.renderer.render(this.scene, this.camera);
    this.submittedFrames++;
    this.outputGroups = new Uint8Array(state.particleGroups ?? []);
    this.outputFrame = this.submittedFrames;
    this.outputParts = (state.particleParts ?? []).map(part => ({ id: part.id, kind: part.kind, ...(part.color ? { color: part.color } : {}) }));
    this.outputAt = Date.now();
    void this.capturePreviewFrame();
  }
  private frameScene(state: BodyState) {
    if (this.framedParts !== state.particleParts) {
      this.framedParts = state.particleParts; this.trajectoryFit = undefined;
      if (state.particleParts?.some(part => part.trajectory)) {
        const bounds = trajectorySceneBounds(state.particleParts);
        this.trajectoryFit = frameBody(bounds, bounds.length / 3, this.camera, 1, 0.75);
      }
    }
    if (this.trajectoryFit === undefined) frameBody(this.positions, this.count, this.camera, Number(state.grow));
    else for (let i = 0; i < this.count * 3; i++) this.positions[i] *= this.trajectoryFit;
  }
  private updatePartColors(colors?: Float32Array) {
    this.partColors.fill(0);
    if (colors) this.partColors.set(colors.subarray(0, this.count * 4));
    let signature = 2166136261;
    for (let i = 0; i < this.count * 4; i++) signature = Math.imul(signature ^ Math.round(this.partColors[i] * 10000), 16777619);
    this.colorSignature = signature >>> 0;
    this.geometry.attributes.partColor.needsUpdate = true;
  }
  private outputBounds(group?: number) {
    let particles = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.count * 3; i++) {
      if (group !== undefined && this.outputGroups[Math.floor(i / 3)] !== group) continue;
      if (i % 3 === 0) particles++;
      const axis = i % 3; min[axis] = Math.min(min[axis], this.positions[i]); max[axis] = Math.max(max[axis], this.positions[i]);
    }
    return { particles, bounds: particles ? { min, max } : null };
  }
  inspectOutput() {
    return { ...this.renderSnapshot, contentFrame: this.outputFrame, capturedAt: this.outputAt, particles: this.count,
      color: '#' + this.material.uniforms.color.value.getHexString(), pointSize: Number(this.material.uniforms.size.value),
      brightness: Number(this.material.uniforms.brightness.value), parts: this.outputParts.map((part, i) => ({ ...part, ...this.outputBounds(i) })), bounds: this.outputBounds().bounds };
  }
  capturePreview(): Promise<RendererPreview> {
    if (this.disposed || this.lost) return Promise.reject(new Error('preview_unavailable'));
    if (this.preview) return Promise.reject(new Error('preview_busy'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.rejectPreview('preview_timeout'), 1500);
      this.preview = { resolve, reject, timer, copying: false };
    });
  }
  private rejectPreview(reason: string) {
    const pending = this.preview;
    if (!pending) return;
    this.preview = undefined; clearTimeout(pending.timer); pending.reject(new Error(reason));
  }
  private async capturePreviewFrame() {
    const pending = this.preview;
    if (!pending || pending.copying) return;
    pending.copying = true;
    try {
      if (this.renderer.getContext().isContextLost()) throw new Error('preview_context_lost');
      const sourceWidth = this.canvas.width, sourceHeight = this.canvas.height;
      if (!sourceWidth || !sourceHeight) throw new Error('preview_empty_canvas');
      const ratio = Math.min(1, 480 / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * ratio)), height = Math.max(1, Math.round(sourceHeight * ratio));
      const copy = new OffscreenCanvas(width, height), context = copy.getContext('2d');
      if (!context) throw new Error('preview_copy_unavailable');
      context.drawImage(this.canvas, 0, 0, width, height);
      const summary = this.inspectOutput();
      const blob = await copy.convertToBlob({ type: 'image/png' });
      if (blob.size > 160 * 1024) throw new Error('preview_image_too_large');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      if (this.preview !== pending) return;
      this.preview = undefined; clearTimeout(pending.timer);
      pending.resolve({ summary, image: { mimeType: 'image/png', data: btoa(binary), width, height, bytes: bytes.length } });
    } catch (error) {
      if (this.preview === pending) this.rejectPreview(error instanceof Error ? error.message : 'preview_capture_failed');
    }
  }
  get renderSnapshot() {
    const signature = particleSignature(this.positions, this.count, [this.material.uniforms.size.value,
      this.material.uniforms.brightness.value, this.color.r, this.color.g, this.color.b, this.colorSignature]);
    return { frame: this.submittedFrames, signature, contextLost: this.lost };
  }
  dispose() {
    this.disposed = true; this.rejectPreview('preview_disposed');
    this.canvas.removeEventListener('webglcontextlost', this.onLost as EventListener);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestore as EventListener);
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}

export type RendererPreview = {
  summary: ReturnType<ThreeRenderer['inspectOutput']>;
  image: { mimeType: 'image/png'; data: string; width: number; height: number; bytes: number };
};