import type { CausalSink } from './causal-recorder-types';
import type { LiveCompiled } from './control-types';
import type { HandReadSet, ReactiveOwnership, ReactiveRequest } from './decision-types';
import type { LeaseRevokeReason, ReactiveLease } from './reactive-lease';
import type { HandWireEvent, LiveEventKind, Observation } from './types';

export type SessionEvent = ({ type: LiveEventKind; seq: number; at: number; sourceSeq?: number }) | (HandWireEvent & { seq: number });
export type ReactiveWindowEvent = { id: number; type: LiveEventKind; at: number; sourceSeq?: number } | (HandWireEvent & { id: number });
export type ReactiveWindow = Readonly<{ schemaVersion: 1; request: ReactiveRequest;
  events: readonly Readonly<ReactiveWindowEvent>[]; observations: readonly Observation[] }>;
export type SessionOptions = {
  record?: CausalSink;
  handState?: () => HandReadSet | undefined;
  handMotion?: () => number | null;
  now: () => number; wallNow: () => number; epoch: () => string; id: () => string; canAdmit: () => boolean;
  admit: (compiled: LiveCompiled, owner: ReactiveOwnership) => void;
  cancel: (owner: ReactiveLease, reason: LeaseRevokeReason) => void;
};
