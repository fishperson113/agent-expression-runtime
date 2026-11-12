import * as THREE from 'three';
import type { BodyState, RendererSink } from '../core/ports';
import { MotionPhase } from './motion-phase';
import { capability } from '../primitives/registry';
import { sampleBody } from './body-geometry';
import { TargetBoids } from '../core/geometry/boids';
import { particleSignature } from './particle-signature';
import { shapeBuffers } from '../core/geometry/primitives';
export { shapeBuffers } from '../core/geometry/primitives';
export function frameBody(positions: Float32Array, count: number, camera: THREE.PerspectiveCamera, grow = 1) {
  camera.updateMatrixWorld();
  const view = camera.matrixWorldInverse.elements, projection = camera.projectionMatrix.elements;
  const distance = -view[14], margin = 0.44 * Math.max(0.25, Math.min(2, grow));
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
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private points: THREE.Points;
  private positions = new Float32Array(30000);
  private shapes: Float32Array[];
  private color = new THREE.Color();
  private lost = false;
  private restores = 0;
  private orbit = new MotionPhase();
  count = 10000;
  private submittedFrames = 0;
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
        'uniform float size; uniform float dpr; void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*dpr*clamp(3.8/-p.z,0.75,1.25); gl_Position=projectionMatrix*p; }',
      fragmentShader:
        'uniform vec3 color; uniform float brightness; void main(){float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; gl_FragColor=vec4(color,brightness*(1.0-d*d));\n#include <colorspace_fragment>\n}',
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);
    canvas.addEventListener('webglcontextlost', this.onLost as EventListener);
    canvas.addEventListener('webglcontextrestored', this.onRestore as EventListener);
  }
  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
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
  private outputParts: { id: string; kind: string }[] = [];
  private outputGroups = new Uint8Array();
  private outputAt = 0;
  private outputFrame = 0;
  get contentFrame() { return this.outputFrame; }
  apply(state: BodyState, now: number) {
    if (this.lost) return;
    const amp = this.reducedMotion ? 0.08 : 1;
    const angle = this.orbit.advance(now, state.flowStrength * amp * state.flowWeights[capability.fields.indexOf('orbit')]);
    sampleBody(this.shapes, this.positions, this.count, state, now, angle, this.reducedMotion);
    this.swarm.apply(this.positions, this.count, now, state.particleGroups, !this.reducedMotion);
    frameBody(this.positions, this.count, this.camera, Number(state.grow));
    this.geometry.attributes.position.needsUpdate = true;
    this.material.uniforms.color.value = this.color.set(String(state.color));
    this.material.uniforms.size.value = Number(state.pointSize);
    this.material.uniforms.brightness.value = Number(state.brightness);
    this.renderer.render(this.scene, this.camera);
    this.submittedFrames++;
    this.outputGroups = new Uint8Array(state.particleGroups ?? []);
    this.outputFrame = this.submittedFrames;
    this.outputParts = (state.particleParts ?? []).map(part => ({ id: part.id, kind: part.kind }));
    this.outputAt = Date.now();
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
  get renderSnapshot() {
    const signature = particleSignature(this.positions, this.count, [this.material.uniforms.size.value,
      this.material.uniforms.brightness.value, this.color.r, this.color.g, this.color.b]);
    return { frame: this.submittedFrames, signature, contextLost: this.lost };
  }
  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost as EventListener);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestore as EventListener);
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
