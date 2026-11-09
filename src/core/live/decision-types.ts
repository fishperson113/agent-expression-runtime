import type { LiveCompiled } from './control-types';

export type HandReadSet = Readonly<{ stateRevision: number; sourceGeneration: number; primaryTrackId: string | null }>;
export function freezeHandReadSet(value: unknown): HandReadSet {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('hand_readset');
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length !== 3 || keys.some(key => !['stateRevision', 'sourceGeneration', 'primaryTrackId'].includes(String(key)) || !Object.hasOwn(fields[key as string], 'value'))) throw Error('hand_readset');
  const stateRevision = fields.stateRevision.value, sourceGeneration = fields.sourceGeneration.value, primaryTrackId = fields.primaryTrackId.value;
  if (![stateRevision, sourceGeneration].every(value => Number.isSafeInteger(value) && value >= 0) ||
    (primaryTrackId !== null && (typeof primaryTrackId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(primaryTrackId)))) throw Error('hand_readset');
  return Object.freeze({ stateRevision, sourceGeneration, primaryTrackId });
}
export function matchesHandReadSet(expected: HandReadSet | undefined, state: HandReadSet | undefined): boolean {
  return expected === undefined || !!state && expected.stateRevision === state.stateRevision &&
    expected.sourceGeneration === state.sourceGeneration && expected.primaryTrackId === state.primaryTrackId;
}

export type SemanticSnapshot = Readonly<{ orientation: number | null; expression: number | null; handMotion: number | null; handIdentity: number }>;
export type SemanticPrerequisite = 'orientation' | 'expression' | 'hand_motion';
type RequestFields = Readonly<{ sessionId: string; epoch: string; requestId: string; intentRevision: number;
  presenceRevision?: number; handReadSet?: HandReadSet; deadline: number; requiredTrackIds: readonly string[] }>;
export type ReactiveRequestV1 = RequestFields & Readonly<{ schemaVersion: 1 }>;
export type ReactiveRequestV2 = RequestFields & Readonly<{ schemaVersion: 2; presenceRevision: number; semanticSnapshot: SemanticSnapshot }>;
export type ReactiveRequest = ReactiveRequestV1 | ReactiveRequestV2;
export type ReactiveState = {
  sessionId: string; epoch: string; intentRevision: number; presenceRevision?: number; handState?: HandReadSet; trackIds: readonly string[];
  sourceHealthy?: boolean; semanticSnapshot?: SemanticSnapshot;
};
export type ReactiveAdapter = {
  decide(request: ReactiveRequest, signal: AbortSignal): Promise<unknown>;
};
export type DecisionReason = 'observed' | 'accepted' | 'busy' | 'duplicate' | 'capacity' |
  'invalid_request' | 'invalid_decision' | 'stale' | 'revoked' | 'transport_unknown' | 'admission_failed';
export type DecisionMetadata = { decisionVersion?: 2; prerequisites?: readonly SemanticPrerequisite[]; executionValidUntil?: number };
export type DecisionResult = DecisionMetadata & { reason: DecisionReason; requestId: string; decisionId?: string; transportToken?: number };
export type ReactiveOwnership = Readonly<DecisionMetadata & {
  requestId: string; decisionId: string; actionId: string; validUntil: number;
}>;
/** Trusted synchronous admission only; implementations must not await. */
export type DecisionAdmission = (compiled: LiveCompiled, ownership: ReactiveOwnership) => void;
