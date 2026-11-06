import manifest from '../contracts/capabilities.json';
import type { Property } from '../core/ast/types';
export const primitives = Object.freeze({
  shapeQuality: {
    writes: ['rise', 'advance', 'spread', 'grow', 'arcOffset', 'effortFlow'] as Property[],
    cost: 1,
  },
  morph: { writes: ['shape'] as Property[], cost: 1, targets: manifest.shapes },
  flow: { writes: ['flow'] as Property[], cost: 1, fields: manifest.fields },
  style: { writes: ['color', 'brightness', 'pointSize', 'dispersion'] as Property[], cost: 1 },
});
export const capability = Object.freeze(manifest);
