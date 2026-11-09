import type { ReactiveOwnership, ReactiveRequest, ReactiveState } from './decision-types';

export type ReactiveLease = Readonly<ReactiveRequest & ReactiveOwnership & { generation: number }>;
export type LeaseRevokeReason = 'expired' | 'session_changed' | 'epoch_changed' | 'intent_changed' |
  'presence_changed' | 'track_lost' | 'revoked';

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
    if (this.active || this.actions.size >= 256 || this.actions.has(ownership.actionId) || generation !== this.revision || ownership.requestId !== request.requestId ||
      !Number.isFinite(request.deadline) || !Number.isFinite(ownership.validUntil) || ownership.validUntil > request.deadline) return false;
    const owner = Object.freeze({ ...request, ...ownership, generation,
      requiredTrackIds: Object.freeze([...request.requiredTrackIds]) });
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
    if (!Number.isFinite(now) || now < 0 || now >= owner.validUntil || now >= owner.deadline) return 'expired';
    if (state.sessionId !== owner.sessionId) return 'session_changed';
    if (state.epoch !== owner.epoch) return 'epoch_changed';
    if (state.intentRevision !== owner.intentRevision) return 'intent_changed';
    if (owner.presenceRevision !== undefined && state.presenceRevision !== owner.presenceRevision) return 'presence_changed';
    if (!owner.requiredTrackIds.every(track => state.trackIds.includes(track))) return 'track_lost';
  }
}
