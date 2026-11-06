import * as THREE from 'three';
import type { BodyState, RendererSink } from '../core/ports';
import { MotionPhase } from './motion-phase';
import { capability } from '../primitives/registry';
function shapePoints(u: number, v: number, w: number): Record<string, number[]> {
  const angle = u * Math.PI * 2, y = 1 - 2 * v, radius = Math.sqrt(1 - y * y);
  return {
    sphere: [radius * Math.cos(angle), y, radius * Math.sin(angle)],
    wall: [u * 2 - 1, y, (w - 0.5) * 0.04],
    wave: [u * 2 - 1, Math.sin(u * 8 + v * 4) * 0.22, v * 2 - 1],
    cloud: [(u * 2 - 1) * 0.9, y * 0.9, (w * 2 - 1) * 0.9],
    pin: [Math.cos(angle) * 0.06, y, Math.sin(angle) * 0.06],
    screw: [Math.cos(v * Math.PI * 6) * 0.45, y, Math.sin(v * Math.PI * 6) * 0.45],
    pyramid: [(u * 2 - 1) * v, y, (w * 2 - 1) * v],
  };
}
export function shapeBuffers(count: number, seed = 42) {
  let s = seed;
  const random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const shapes = capability.shapes.map(() => new Float32Array(count * 3));
  for (let i = 0; i < count; i++) {
    const points = shapePoints(random(), random(), random());
    capability.shapes.forEach((name, k) => {
      if (!points[name]) throw Error('shape_generator_missing:' + name);
      shapes[k].set(points[name], i * 3);
    });
  }
  return shapes;
}
export function frameBody(positions: Float32Array, count: number, camera: THREE.PerspectiveCamera) {
  camera.updateMatrixWorld();
  const view = camera.matrixWorldInverse.elements, projection = camera.projectionMatrix.elements;
  const distance = -view[14], margin = 0.88;
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
    this.renderer.setClearColor(0x080e14, 1);
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
        'uniform vec3 color; uniform float brightness; void main(){float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; gl_FragColor=vec4(color,brightness*(1.0-d*d));}',
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
  }
  quality(count: number) {
    this.count = count;
    this.geometry.setDrawRange(0, count);
  }
  apply(state: BodyState, now: number) {
    if (this.lost) return;
    const t = now / 1000,
      amp = this.reducedMotion ? 0.08 : 1,
      strength = state.flowStrength * amp,
      dispersion = Number(state.dispersion);
    const fields = Object.fromEntries(capability.fields.map((name, i) => [name, state.flowWeights[i]]));
    const orbitAngle = this.orbit.advance(now, strength * fields.orbit);
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      let x = 0,
        y = 0,
        z = 0;
      for (let k = 0; k < this.shapes.length; k++) {
        const weight = state.shapeWeights[k];
        x += this.shapes[k][j] * weight;
        y += this.shapes[k][j + 1] * weight;
        z += this.shapes[k][j + 2] * weight;
      }
      const phase = i * 0.618;
      let scale = 1;
      scale += Math.sin(t * 2) * strength * 0.16 * fields.pulse;
      x += Math.sin(phase + t) * strength * 0.15 * fields.turbulence;
      y += Math.cos(phase * 1.3 + t) * strength * 0.15 * fields.turbulence;
      const a = orbitAngle,
        c = Math.cos(a),
        s = Math.sin(a);
      const jitter = dispersion * 0.12;
      x += Math.sin(phase + t * 2) * Number(state.effortFlow) * 0.03 * amp;
      y += Math.cos(phase * 1.7 + t * 2) * Number(state.effortFlow) * 0.03 * amp;
      const grow = Number(state.grow),
        spread = Number(state.spread);
      this.positions[j] =
        ((x * c - z * s) * scale + Math.sin(phase) * jitter) * grow * spread +
        Number(state.arcOffset) * amp;
      this.positions[j + 1] =
        (y * scale + Math.cos(phase) * jitter) * grow + Number(state.rise) * amp;
      this.positions[j + 2] = (x * s + z * c) * scale * grow + Number(state.advance) * amp;
    }
    frameBody(this.positions, this.count, this.camera);
    this.geometry.attributes.position.needsUpdate = true;
    this.material.uniforms.color.value = this.color.set(String(state.color));
    this.material.uniforms.size.value = Number(state.pointSize);
    this.material.uniforms.brightness.value = Number(state.brightness);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost as EventListener);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestore as EventListener);
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
