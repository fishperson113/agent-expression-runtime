---
kind: object
universe: live
status: verified
verified_at: 2026-11-13
source_revision: e1bd851
---
# Live body - presentation and ownership in the browser

## Why this shape
Input can change before model inference finishes. Presentation ownership and
causal admission must remain explicit, independent of how pretty a scene looks.

## Shape and source
- [LiveBody](../../../src/live/body.ts) composes LiveCompiler, Scheduler and renderer.
- [bridge](../../../src/live/bridge.ts) routes browser gateway admission to the body.
- [presentationDuration](../../../src/core/live/presentation-duration.ts) includes
  trajectory presentation timing used by ownership leases.
- [ReactiveSession](../../../src/core/live/reactive-session.ts) and
  [reactive leases](../../../src/core/live/reactive-lease.ts) guard observer ownership.
- [Scheduler](../../../src/core/runtime/scheduler.ts) owns deterministic execution.

## Connected to
Consumes [expression](expression.md); receives intent/context from
[conversation](conversation.md). Live directly constructs its compiler; do not
confuse it with the historical worker compiler host in src/app/.

## If you change this
Hits: admission/cancel, transient versus persistent scene handoff, trajectory
completion, frame observation, motion-off and reset tests.
Does not hit: model authentication or native thread selection by itself.

## Surfaces
Browser controls, gateway mutations and observer decisions. Existing epoch,
new-intent and revocation fences remain authoritative.

## See
[Reactive contract](../../reactive-provider.md),
[presentation lease tests](../../../tests/trajectory-presentation-leases.test.ts),
[body tests](../../../tests/live-reactive-body.test.ts).
