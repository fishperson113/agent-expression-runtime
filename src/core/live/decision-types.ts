import type { LiveCompiled } from './control-types';

export type ReactiveRequest = Readonly<{
  schemaVersion: 1; sessionId: string; epoch: string; requestId: string;
  intentRevision: number; deadline: number; requiredTrackIds: readonly string[];
}>;
export type ReactiveState = {
  sessionId: string; epoch: string; intentRevision: number; trackIds: readonly string[];
};
export type ReactiveAdapter = {
  decide(request: ReactiveRequest, signal: AbortSignal): Promise<unknown>;
};
export type DecisionReason = 'observed' | 'accepted' | 'busy' | 'duplicate' | 'capacity' |
  'invalid_request' | 'invalid_decision' | 'stale' | 'revoked' | 'transport_unknown' | 'admission_failed';
export type DecisionResult = { reason: DecisionReason; requestId: string; decisionId?: string; transportToken?: number };
/** Trusted synchronous admission only; implementations must not await. */
export type DecisionAdmission = (compiled: LiveCompiled, ownership: Readonly<{
  requestId: string; decisionId: string; actionId: string; validUntil: number;
}>) => void;
