# Session playground desired-state engine

This independent engine journals agent-authored co-create/remix snapshots, undo,
reset and optional inert goals. It emits a bounded **unexecuted two-command plan**, with no runtime/server/launcher
wiring or user-facing exposure yet.
No language/gesture-to-shape lookup, model call, media access or persistence exists.
A canonical scene contains arbitrary schema-valid `parts`, explicit `style`
(`color`, `pointSize`, `brightness`, `dispersion`) and `flow` (`field`, `strength`).
Optional `goal` is untrusted inert text, limited to 160 UTF-16 units without control
characters; nothing automatically interprets it or declares it achieved.
`current()` explicitly returns a clone to its authorized owner; `status()` returns
only revision/counts/bytes/pending metadata, never geometry or goal text.

## Plan and journal contract

`PlaygroundSession(sessionId).propose({sessionId,expectedRevision,operation,scene})`
reserves one transaction. Operations: first `create`, complete-snapshot `remix`,
`undo` or `reset` without scene. Undo selects the preceding retained snapshot.
Reset selects the first applied snapshot and clears later history; undo then fails
until a new remix. Revision/history change only after both phases are applied
and completed, in that order per phase; applied alone may describe a partial frame.
The returned `commands` must be sent in order through the same host controller:
Remove `phase` metadata before `express`; use distinct stable request IDs such as
`transaction:body` and `transaction:baseline` (never reuse one ID for both).

1. `phase: body`: Live program, policy replace, with assembly, explicit color/style/
   flow, neutral shapeQuality (rise/advance=0, grow/spread=1, path=spoke,
   effort.flow=0), empty controls/poses and a 60-second configuration lease.
2. `phase: baseline`: schema-valid state patch with brightness/pointSize/dispersion,
   rise/advance=0, spread/grow=1, durationMs=600 and easing=smoothstep. No invented
   arcOffset/effortFlow state fields are emitted. Unsupported posture baselines are
   assumed default zero; the body explicitly targets neutral path/effort.
The baseline is essential: actual Scheduler testing showed a one-body request
.8/1.2/.4 brightness/pointSize/dispersion returning to .65/2/.12 after ownership
release. A regression failed with that one-body implementation, then passed with
both commands at 1200/2000 ms. This is supported-state persistence, not every
scheduler property, animation phase or a pixel-perfect frame.
`admit(transaction,phase,receipt)` requires exact session on accepted/pending
receipts, a real UUID epoch and safe increasing sequence. Phases need distinct
sequences in one epoch; old epochs cannot reappear (64-epoch bound). Generic
pre-admission local rejection may omit session; explicit foreign IDs are refused.
Admission is not application. `feedback({session,epoch,seq,status})` consumes only
host-authenticated exact-match evidence. Both phases must reach applied then
completed before commit. Completion without prior application latches desync; one completed
phase is insufficient. Pending cannot downgrade an ACK.
**Logical transaction only; visual execution is not atomic.** State admission
already changes baseline even before applied feedback. Therefore cancellation,
partial rejection, gap or `uncertain(transaction)` latches desynchronized and
blocks all edits/retries; late applied events cannot clear it. There is no rollback
claim. Cancellation after journal commit cannot retroactively undo it either.
Only `admit(tx,phase,receipt,true)` with an authoritative gateway pre-admission
body rejection releases an untouched reservation. The default false treats wrapper
rejections/timeouts/transport errors as uncertain. A desync latch never clears on
late pending/accepted/applied/completed/rejected messages, even with no first ACK.
History pins the first scene plus eleven later scenes. Scene size <=32 KiB,
command size <=32 KiB, unique committed/pending scene records <=128 KiB. Inputs
and outputs are cloned; schema validation and duplicate-ID checks precede mutation.
The runtime compiler is final authority. `dispose()` clears private state/ownership.

## Remaining parent integration blocker

Use the existing `integrations/mcp-server.mjs` session and serialized mutation
queue; a second MCP/controller is invalid. Do not expose admit/feedback/uncertain
as model-callable confirmation tools. Subscribe to authenticated
`GET /v1/sessions/{id}/events` SSE before sending. Send body then baseline, bind
both receipts by phase, and replay a bounded early-feedback buffer after binding.
Do not substitute snapshot/frame/debug evidence for applied status. Mark desync
on gap/close/transport uncertainty. Before disposal and explicit new recovery,
the host must confirm old-epoch invalidation via cancel/session close, so delayed
old requests cannot land after new work. Never silently replay across sessions.
User-facing tools/UI and end-to-end dual-receipt/SSE tests remain parent work.
Tests cover synthetic journal remixes/bounds, failure/cancel/uncertainty, cloning,
compiler validation and real Scheduler persistence. They establish neither atomic
visual execution, a 20-minute elapsed soak nor human enjoyment.
