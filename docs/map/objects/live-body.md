---
kind: object
universe: live
status: verified
verified_at: 2026-11-13
source_revision: eec3c29 + host-scene-append working tree
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

- [appendScene](../../../src/core/live/scene-extension.ts) resolves opt-in
  `configuration.sceneAppend:true` against the executed authored scene at MAIN
  admission, not the model's remembered scene. Only one assemble with optional
  style/flow is accepted. Busy, hidden, off, frozen, observer-owned and stale-epoch
  scenes reject; duplicate IDs, trajectory groups and expanded limits reject.
  Append is atomic current-at-admission, not a revision-based edit or queue.
  Omitted style/flow leave their state unchanged; existing live-control clocks
  and leases are preserved, not extended. New controls/poses in append reject.
  Append is persistent: transient:true and observerHandoffMs reject rather than
  making inherited protected geometry disposable. Per-prop expiry is unsupported. Legacy replacement remains unchanged.

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
[body tests](../../../tests/live-reactive-body.test.ts),
[append tests](../../../tests/scene-append.test.ts).
