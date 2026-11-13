import { afterEach, expect, it, vi } from 'vitest';
import { LiveBody } from '../src/live/body.ts';
import { freezeNativeHostCapabilities } from '../integrations/native-reaction-provider.mjs';
afterEach(() => vi.restoreAllMocks());
function fixture() {
  let now = 9000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const body = Object.create(LiveBody.prototype);
  Object.assign(body, { scheduler: { epoch: 'a', busy: false }, controls: { mode: 'normal' },
    userLeaseUntil: 0, userGeometryLocked: true, attention: { revoke: vi.fn() }, reactive: { userIntent: vi.fn() },
    publicContext: { epoch: 'a', seq: 7, until: 10000, text: 'Public shared activity', mode: 'quiet' } });
  return { body, time: value => { now = value; } };
}
it('never resurrects expired quiet authority after clock rollback or refreshes its fixed deadline', () => {
  const { body, time } = fixture();
  expect(body.canConverse()).toBe(false);
  time(10000); const held = body.observerContextReadKey();
  expect(body.canConverse()).toBe(true);
  time(9999); expect(body.observerContext()).toBeNull(); expect(body.canConverse()).toBe(true);
  expect(body.matchesObserverContext(held)).toBe(true);
  time(129999); expect(body.matchesObserverContext(held)).toBe(true);
  time(130000); expect(body.matchesObserverContext(held)).toBe(false);
  expect(body.recentObserverContext()).toBeNull();
  time(11000); expect(body.recentObserverContext()).toBeNull();
});
it('revokes held historical reads on new intent and preserves only explicitly retained transient scene intent', () => {
  const { body, time } = fixture(); time(11000);
  const held = body.observerContextReadKey(); body.transientScene = { epoch: 'a', seq: 3 };
  body.revokeObserverHandoff(true);
  expect(body.matchesObserverContext(held)).toBe(false);
  expect(body.transientScene).toEqual({ epoch: 'a', seq: 3 });
  body.prepareUserMutation(); expect(body.transientScene).toBeUndefined();
  expect(body.reactive.userIntent).toHaveBeenCalledOnce();
});
it('does not unlock a protected authored scene merely because quiet becomes historical', () => {
  const { body, time } = fixture(); time(11000);
  expect(body.recentObserverContext()).toMatchObject({ expired: true, previousMode: 'quiet' });
  expect(body.canConverse()).toBe(true); expect(body.canReactive()).toBe(false);
  body.scheduler.epoch = 'b'; expect(body.recentObserverContext()).toBeNull();
  expect(body.canReactive()).toBe(false);
});
it('keeps a fresh current turn alongside expired public history without promoting either to authority', () => {
  const context = { revision: 1, submissionId: 's', threadId: 't', turnId: 'u', text: 'Current public exchange', ageMs: 12 };
  const recent = { revision: 7, text: 'Prior shared activity', previousMode: 'quiet', expired: true };
  const result = freezeNativeHostCapabilities({ schemaVersion: 1, expressionAllowed: false,
    recentInteractionContext: recent, currentTurnContext: context });
  expect(result.expressionAllowed).toBe(false); expect(result.interactionContext).toBeUndefined();
  expect(result.currentTurnContext.text).toBe(context.text);
  expect(Object.isFrozen(result.recentInteractionContext)).toBe(true);
});
