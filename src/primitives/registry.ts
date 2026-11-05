import type { Property } from '../core/ast/types';
export const primitives = Object.freeze({
  morph: { writes: ['shape'] as Property[], cost: 1, targets: ['sphere', 'ring', 'wave', 'cloud'] },
  flow: { writes: ['flow'] as Property[], cost: 1, fields: ['orbit', 'turbulence', 'pulse'] },
  style: { writes: ['color', 'brightness', 'pointSize', 'dispersion'] as Property[], cost: 1 },
});
export const capability = Object.freeze({
  v: 1,
  revision: 'poc-1',
  tracks: ['body'],
  shapes: primitives.morph.targets,
  fields: primitives.flow.fields,
  easing: ['linear', 'smoothstep'],
  limits: {
    recordBytes: 32768,
    depth: 16,
    inputNodes: 128,
    expandedNodes: 512,
    macros: 32,
    params: 8,
    durationMs: 10000,
    queue: 8,
    inFlight: 4,
    recordsPerSecond: 10,
    pointSize: 8,
    ttlMs: 5000,
  },
  particles: [10000, 5000, 2000],
});
