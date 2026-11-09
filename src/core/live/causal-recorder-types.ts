import type { Observation, LiveSourceEvent } from './types';
import type { DecisionReason, ReactiveRequest } from './decision-types';
export const causalRevocationReasons = ['enabled', 'disabled', 'unavailable', 'reset', 'session_changed', 'epoch_changed', 'presence_changed', 'semantic_changed', 'hand_changed',
  'user_intent', 'user_busy', 'intent_changed', 'deadline', 'source_expired', 'track_lost', 'expired', 'revoked', 'source_unavailable',
  'clock_discontinuity', 'capture_discontinuity', 'invalid_observation', 'invalid_events', 'invalid_request_id'] as const;
export type CausalRef = { sessionId: string; seq: number };
export type CausalOrigin = 'native' | 'reactive' | 'ambient';
export type ProviderReceipt = { requestId: string; modelConfigHash: string; promptHash: string; requestHash: string;
  responseHash: string | null; outcome: 'completed' | 'invalid_response' | 'http_error' | 'transport_unknown';
  durationMs: number | null; usage: 'unknown' | { input_tokens: number; output_tokens: number; total_tokens: number } };
export type CausalPayloads = {
  provider_receipt: ProviderReceipt;
  observation: Observation;
  event: LiveSourceEvent & { sessionId: string; observationSeq: number; seq: number };
  request: { request: ReactiveRequest; observationRefs: CausalRef[]; eventRefs: CausalRef[] };
  authorization: { requestId: string; allowed: boolean; reason: 'authorized' | 'denied' | 'revoked' | 'stale' | 'unavailable' };
  decision: { requestId: string; reason: DecisionReason; decisionId?: string; actionId?: string; mode?: 'observe' | 'express'; validUntil?: number };
  revocation: { reason: typeof causalRevocationReasons[number]; requestId?: string; decisionId?: string; actionId?: string };
  execution: { seq: number; epoch: string; phase: 'received' | 'admitted' | 'rejected' | 'applied' | 'completed' | 'cancelled' | 'frame_submitted' | 'frame_changed_proxy';
    at: number; origin?: CausalOrigin; turn?: number; frame?: number; requestId?: string; decisionId?: string; actionId?: string };
  frame: { frame: number; signature?: number; origin?: CausalOrigin; requestId?: string; decisionId?: string; actionId?: string };
};
export type CausalKind = keyof CausalPayloads;
export type CausalSink = <K extends CausalKind>(kind: K, payload: CausalPayloads[K]) => void;
export type CausalStart = { runId: string; sourceSha?: string; mode: 'synthetic' | 'live-structured'; seed?: number; configHash?: string };
export type CausalRecord = { seq: number; kind: CausalKind; epoch: string; recordedAtMono: number; recordedAtWall: number; payload: unknown };
export type RecorderReason = 'record_quota' | 'byte_quota' | 'record_too_large' | 'invalid_payload' | 'clock_invalid' | 'expired' | 'missing_parent';
export type CausalManifest = CausalStart & { active: boolean; incomplete: boolean; reasons: RecorderReason[]; droppedRecords: number; storedBytes: number; recordCount: number;
  clock: { monotonicOrigin: number; wallOrigin: number; observationCapturedAt: 'wall-ms'; eventAt: 'wall-ms'; requestDeadline: 'host-monotonic-ms'; executionAt: 'host-monotonic-ms' };
  ttlMs: number; expiresAtMono: number; expiresAtWall: number; maxRecords: number; maxBytes: number; maxRecordBytes: number; ended: 'none' | 'stopped' | 'quota' | 'expired' | 'clock_invalid' };
export type CausalSnapshot = { schemaVersion: 1; manifest: CausalManifest | null; records: CausalRecord[] };
