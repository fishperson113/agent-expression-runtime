import { freezeHandReadSet } from './decision-types';
import { freezePrerequisites, freezeSemanticSnapshot, matchesCriticalState, matchesPrerequisites } from './decision-contract';
import type { ReactiveOwnership, ReactiveRequest, ReactiveState } from './decision-types';

export type ReactiveLease = Readonly<ReactiveRequest & ReactiveOwnership & { generation: number }>;
export type LeaseRevokeReason = 'expired' | 'session_changed' | 'epoch_changed' | 'intent_changed' | 'source_unavailable' |
  'presence_changed' | 'hand_changed' | 'track_lost' | 'semantic_changed' | 'revoked';

/** A synchronous execution boundary. The caller checks before admission and every tick. */
export class ReactiveLeaseGuard {
  private active?: ReactiveLease;
  private revision = 0;
  private actions = new Set<string>();
  constructor(private read: () => ReactiveState, private now: () => number,
    private onRevoke: (owner: ReactiveLease, reason: LeaseRevokeReason) => void) {}
  get owner() { return this.active; }
  get generation() { return this.revision; }
  acquire(request: ReactiveRequest, ownership: ReactiveOwnership, generation: number): boolean {
    const now = this.now();
    if (![1, 2].includes(request.schemaVersion) || this.active || this.actions.size >= 256 || this.actions.has(ownership.actionId) || generation !== this.revision || ownership.requestId !== request.requestId ||
      !Number.isFinite(now) || now < 0 || !Number.isFinite(request.deadline) || now >= request.deadline ||
      !Number.isFinite(ownership.validUntil) || now >= ownership.validUntil || ownership.validUntil > request.deadline) return false;
    let hand, semantic, selected;
    try {
      if (Object.hasOwn(request, 'handReadSet')) hand = freezeHandReadSet(request.handReadSet);
      if (request.schemaVersion === 2) {
        semantic = freezeSemanticSnapshot(request.semanticSnapshot); selected = freezePrerequisites(ownership.prerequisites);
        if (ownership.decisionVersion !== 2 || !Number.isFinite(ownership.executionValidUntil) || ownership.executionValidUntil! <= now || ownership.executionValidUntil! > now + 1100) return false;
      }
    } catch { return false; }
    const owner = Object.freeze({ ...request, requestId: ownership.requestId, decisionId: ownership.decisionId, actionId: ownership.actionId,
      validUntil: ownership.validUntil, generation, ...(hand ? { handReadSet: hand } : {}), requiredTrackIds: Object.freeze([...request.requiredTrackIds]),
      ...(request.schemaVersion === 2 ? { semanticSnapshot: semantic!, decisionVersion: 2 as const, prerequisites: selected!, executionValidUntil: ownership.executionValidUntil } : {}) });
    if (this.reason(owner)) return false;
    this.actions.add(owner.actionId); this.active = owner; return true;
  }
  check(): boolean {
    if (!this.active) return false;
    const reason = this.reason(this.active);
    if (reason) { this.revoke(reason); return false; }
    return true;
  }
  revoke(reason: LeaseRevokeReason = 'revoked') {
    this.revision++;
    const owner = this.active; this.active = undefined;
    if (owner) this.onRevoke(owner, reason);
  }
  release(actionId: string): boolean {
    if (!this.active || this.active.actionId !== actionId) return false;
    this.active = undefined; this.revision++; return true;
  }
  private reason(owner: ReactiveLease): LeaseRevokeReason | undefined {
    const state = this.read(), now = this.now();
    const expiry = owner.schemaVersion === 2 ? owner.executionValidUntil! : Math.min(owner.validUntil, owner.deadline);
    if (!Number.isFinite(now) || now < 0 || !Number.isFinite(expiry) || now >= expiry) return 'expired';
    if (!matchesCriticalState(owner, state)) {
      if (owner.schemaVersion === 2 && state.sourceHealthy !== true) return 'source_unavailable';
      if (state.sessionId !== owner.sessionId) return 'session_changed';
      if (state.epoch !== owner.epoch) return 'epoch_changed';
      if (state.intentRevision !== owner.intentRevision) return 'intent_changed';
      if (owner.presenceRevision !== undefined && state.presenceRevision !== owner.presenceRevision) return 'presence_changed';
      if (!owner.requiredTrackIds.every(track => state.trackIds.includes(track))) return 'track_lost';
      return 'hand_changed';
    }
    if (owner.schemaVersion === 2 && !matchesPrerequisites(owner, state, owner.prerequisites!)) return 'semantic_changed';
  }
}
