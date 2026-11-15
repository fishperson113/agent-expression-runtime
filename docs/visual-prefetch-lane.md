# Bounded speculative visual-author lane (prototype)

`PrefetchPresentationProvider` accepts two independent `NativePresentationProvider`
instances with matching visual configuration. No production factory enables it.
Each native provider may use the opt-in warm transport; every inference still
creates its own ephemeral thread. Native conversation is unchanged.

While the authoritative bridge authors the selected excerpt, the second provider
may author one pending complete excerpt. One newer queued request replaces older
queued requests. Only one validated atomic record is cached. The speculative
lane never obtains browser ownership or publishes directly: the original bridge
must select that exact source and pass its normal admission gates first.

The key binds exact input/context bytes, document/thread/turn/generation/message,
source range/hash/revision, original deadline, and declared provider/policy
configuration. This is declared configuration identity, not proof that provider-side
default configuration stayed unchanged; record actual configuration in trials.
No refreshed TTL, repaired quotes, new claims or invented edges.
Source correction/invalidation cancels speculative work and clears pending/cache.
Unclaimed inference can be wasted when a newer source replaces it; telemetry must
report that cost, not count dropped/retained output as visual success.

This targets queue waiting, not the measured multi-second model response floor.
Tests and real browser evidence must compare coverage, source age at visibility,
work discarded, and total model calls as well as setup/record latency. A faster
private cache hit is not evidence of synchronized or informative visuals.
