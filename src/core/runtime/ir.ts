import type { Easing, Envelope, Property, Value } from '../ast/types';
export type Op = {
  at: number;
  duration: number;
  easing: Easing;
  property: Property;
  value: Value;
  strength?: number;
  arcAmplitude?: number;
  effort?: { time?: number; weight?: number };
};
export type ProgramIR = {
  kind: 'program';
  epoch: string;
  seq: number;
  ttlMs: number;
  receivedAt: number;
  deadlineAt?: number;
  policy: 'append' | 'replace';
  duration: number;
  ops: Op[];
  seed: number;
};
export type StateIR = {
  kind: 'state';
  epoch: string;
  seq: number;
  ttlMs: number;
  receivedAt: number;
  deadlineAt?: number;
  patch: Partial<Record<'brightness' | 'pointSize' | 'dispersion', number>>;
  duration: number;
  easing: Easing;
};
export type Compiled =
  | ProgramIR
  | StateIR
  | {
      kind: 'define';
      epoch: string;
      seq: number;
      draft?: number;
      ttlMs: number;
      receivedAt: number;
      deadlineAt?: number;
    };
export type CompileInput = { record: Envelope; receivedAt: number };
