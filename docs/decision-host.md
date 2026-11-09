# Offline reactive decision boundary

`ReactiveDecisionHost` is an unwired core increment for fake-transport tests. It
makes no model calls and does not enable a live actor, camera, renderer or tools.
PR #51's unrelated autonomous output remains an unresolved acceptance blocker.
This host alone does not establish provider capability isolation or naturalness.

`run(request, adapter, admit)` copies and freezes a version-1 request containing
session, epoch, request ID, intent revision, monotonic deadline and at most 16
required track IDs. The state reader and clock are injected. A newer observation
of the same track remains compatible; missing tracks, changed intent/session/epoch
or expired request/decision validity prevent admission. This is a partial
semantic read-set covering track membership, not every world-state dependency.

The adapter returns data only: schema version, request/decision IDs, mode,
validUntil and action. Observe requires a null action. Express requires one action
ID and an existing declarative DSL body. Extra text/fields, unknown primitives,
script payloads and out-of-bounds transforms fail closed. The host constructs the
program envelope and uses LiveCompiler; there is no evaluation of generated code.

After await, the host checks causality, validates and compiles the whole body,
then checks causality again immediately before synchronous admission. `admit` is a
trusted synchronous callback; it must not return deferred work or await. The
caller still owns execution-time leases, channel arbitration, tracking checks on
subsequent ticks and applying revocation to an already admitted action. These
execution responsibilities are not implemented or claimed by this increment.

One transport slot remains occupied until its promise settles, including after
`revoke()` signals abort. Rejection is an unknown transport outcome: new dispatch
stays blocked until the trusted transport owner explicitly confirms settlement
using the exact returned `transportToken`. Neither abort nor promise rejection
proves provider completion or zero cost. A confirmation does not retry a request.
No production adapter currently supplies such confirmation.

Request, decision and action receipts prevent repeat delivery. Each host retains
at most 256 request receipts and fails closed at capacity rather than evicting IDs
and silently reopening replay. Create a fresh host only for an explicitly new
lifecycle after outstanding transport and execution ownership are reconciled.
Tests cover newer-compatible tracks, delayed lost-track/intent/reset/TTL drops,
compile-to-admit revocation, duplicates, bounded capacity and unknown outcomes.
