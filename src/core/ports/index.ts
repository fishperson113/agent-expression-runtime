import type { Property, Value } from '../ast/types';
export interface Clock {
  now(): number;
}
export type BodyState = Record<Property, Value> & {
  flowStrength: number;
  shapeWeights: number[];
  flowWeights: number[];
  particlePositions?: Float32Array;
  particleGroups?: Uint8Array;
};
export interface RendererSink {
  apply(state: BodyState, now: number): void;
  dispose(): void;
}
export interface DiagnosticsSink {
  count(code: string): void;
}
