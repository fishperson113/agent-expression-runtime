import * as THREE from 'three';
import type { BodyState, RendererSink } from '../core/ports';
export function shapeBuffers(count: number, seed = 42) {
  let s = seed;
  const random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const shapes = Array.from({ length: 4 }, () => new Float32Array(count * 3));
  for (let i = 0; i < count; i++) {
    const u = random(),
      v = random(),
      w = random(),
      angle = u * Math.PI * 2,
      z = 1 - 2 * v,
      r = Math.sqrt(1 - z * z),
      j = i * 3;
    const points = [
      [r * Math.cos(angle), z, r * Math.sin(angle)],
      [
        Math.cos(angle) * (0.85 + 0.12 * Math.cos(v * 6.28)),
        0.12 * Math.sin(v * 6.28),
        Math.sin(angle) * (0.85 + 0.12 * Math.cos(v * 6.28)),
      ],
      [u * 2 - 1, Math.sin(u * 8 + v * 4) * 0.22, v * 2 - 1],
      [(u * 2 - 1) * 0.9, (v * 2 - 1) * 0.9, (w * 2 - 1) * 0.9],
    ];
    points.forEach((p, k) => shapes[k].set(p, j));
  }
  return shapes;
}
export class ThreeRenderer implements RendererSink {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private points: THREE.Points;
  private positions = new Float32Array(30000);
  private shapes = shapeBuffers(10000);
  private color = new THREE.Color();
  private lost = false;
  private restores = 0;
  count = 10000;
  reducedMotion = false;
  constructor(
    private canvas: HTMLCanvasElement | OffscreenCanvas,
    private fault: (code: string) => void,
  ) {
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
        'uniform float size; uniform float dpr; void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*dpr*(3.8/-p.z); gl_Position=projectionMatrix*p; }',
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
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
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
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      let x = 0,
        y = 0,
        z = 0;
      for (let k = 0; k < 4; k++) {
        const weight = state.shapeWeights[k];
        x += this.shapes[k][j] * weight;
        y += this.shapes[k][j + 1] * weight;
        z += this.shapes[k][j + 2] * weight;
      }
      const phase = i * 0.618;
      let scale = 1;
      if (state.flow === 'pulse') scale += Math.sin(t * 2) * strength * 0.16;
      if (state.flow === 'turbulence') {
        x += Math.sin(phase + t) * strength * 0.15;
        y += Math.cos(phase * 1.3 + t) * strength * 0.15;
      }
      const a = state.flow === 'orbit' ? t * strength * 0.35 : 0,
        c = Math.cos(a),
        s = Math.sin(a);
      const jitter = dispersion * 0.12;
      this.positions[j] = (x * c - z * s) * scale + Math.sin(phase) * jitter;
      this.positions[j + 1] = y * scale + Math.cos(phase) * jitter;
      this.positions[j + 2] = (x * s + z * c) * scale;
    }
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
