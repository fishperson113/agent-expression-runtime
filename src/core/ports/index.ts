import type { Property, Value } from '../ast/types';
import type { Part } from '../geometry/types';
import type { LiveMatrix } from '../live/transforms';
export interface Clock {
  now(): number;
}
export type BodyState = Record<Property, Value> & {
  flowStrength: number;
  shapeWeights: number[];
  flowWeights: number[];
  particlePositions?: Float32Array;
  particleGroups?: Uint8Array;
  particleParts?: Part[];
  liveMatrices?: (LiveMatrix | undefined)[];
  ownedProperties?: Property[];
};
export interface RendererSink {
  apply(state: BodyState, now: number): void;
  dispose(): void;
}
export interface DiagnosticsSink {
  count(code: string): void;
}
