import type { BodyState } from '../core/ports';
import { capability } from '../primitives/registry';
export function sampleBody(shapes: Float32Array[], positions: Float32Array, count: number, state: BodyState, now: number, orbitAngle: number, reducedMotion = false) {
    const t = now / 1000,
      amp = reducedMotion ? 0.08 : 1,
      strength = state.flowStrength * amp,
      dispersion = Number(state.dispersion);
    const fields = Object.fromEntries(capability.fields.map((name, i) => [name, state.flowWeights[i]]));

    for (let i = 0; i < count; i++) {
      const j = i * 3;
      let x = 0,
        y = 0,
        z = 0;
      for (let k = 0; k < shapes.length; k++) {
        const weight = state.shapeWeights[k];
        x += shapes[k][j] * weight;
        y += shapes[k][j + 1] * weight;
        z += shapes[k][j + 2] * weight;
      }
      if (state.particlePositions) {
        x = state.particlePositions[j]; y = state.particlePositions[j + 1]; z = state.particlePositions[j + 2];
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
      positions[j] =
        ((x * c - z * s) * scale + Math.sin(phase) * jitter) * grow * spread +
        Number(state.arcOffset) * amp;
      positions[j + 1] =
        (y * scale + Math.cos(phase) * jitter) * grow + Number(state.rise) * amp;
      positions[j + 2] = (x * s + z * c) * scale * grow + Number(state.advance) * amp;
    }
}
