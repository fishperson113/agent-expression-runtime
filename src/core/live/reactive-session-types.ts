import type { CausalSink } from './causal-recorder-types';
import type { LiveCompiled } from './control-types';
import type { ReactiveOwnership, ReactiveRequest } from './decision-types';
import type { LeaseRevokeReason, ReactiveLease } from './reactive-lease';
import type { LiveEventKind, Observation } from './types';

export type SessionEvent = { type: LiveEventKind; seq: number; at: number };
export type ReactiveWindow = Readonly<{ schemaVersion: 1; request: ReactiveRequest;
  events: readonly Readonly<{ id: number; type: LiveEventKind; at: number }>[]; observations: readonly Observation[] }>;
export type SessionOptions = {
  record?: CausalSink;
  now: () => number; wallNow: () => number; epoch: () => string; id: () => string; canAdmit: () => boolean;
  admit: (compiled: LiveCompiled, owner: ReactiveOwnership) => void;
  cancel: (owner: ReactiveLease, reason: LeaseRevokeReason) => void;
};
