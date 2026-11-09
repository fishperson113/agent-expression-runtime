# Session playground desired-state engine

The desired-state engine journals agent-authored co-create/remix snapshots, undo,
reset and optional inert goals. Live MCP exposes `playground_state` and
`playground_edit` through its existing controller; the engine emits a bounded
two-command plan which the controller applies and verifies.
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

## Live MCP integration

Start normal `fisch live`. Ask the agent to co-create a particle creation, change
your own choice, undo it or reset to the first creation. The agent authors full
geometry through `playground_edit`; no phrase or hand pose directly selects an
effect. No additional controller, browser, login or media consent is created.
`playground_state` defaults to redacted counters and revision. Only an explicit
`includeScene:true` returns a private scene clone to the authorized agent.

One manager binds the existing authenticated gateway session. It subscribes to
`GET /v1/sessions/{id}/events` before submitting body then baseline in the same
mutation queue, with distinct stable request IDs. It buffers at most 64 early
feedback events until their receipts bind. The queue releases after sends, while
the tool waits separately for completion, allowing cancellation and ordinary
content to remain responsive. Overall application deadline is three seconds.
Only exact session/epoch/sequence applied-then-completed evidence commits both
phases. Snapshot, admitted/pending, frame hashes and foreign tuples never count.
An HTTP pending receipt waits for its matching authenticated SSE accepted event;
neither phase is reposted, and acceptance alone never commits history.

The SSE client uses authenticated loopback HTTP, bounded UTF-8 framing and no
reconnect. Gap, close, malformed stream, timeout, cancellation and transport loss
fail closed; uncertainty never causes automatic replay. A new ordinary mutation
after interruption first revokes the captured old owner, preventing delayed old
HTTP requests from overwriting newer work. A temporary ordinary expression after
a completed creation leaves its selected history intact while ownership stays
valid. UI cancel, reload or changed ownership requires explicit recovery.

`playground_edit` supports `operation:create|remix|undo|reset|recover` and requires
the revision just read; only create/remix accept a scene. Explicit recover closes
the old controller and verifies a changed owner/epoch before clearing private
history. It does not automatically restore the old creation. Confirmation and
feedback methods are host-only, never model-callable tools. Session close stops
the SSE reader and pending timer. Goals/scenes are never written to disk or logs.

Tests cover journal bounds, real Scheduler style persistence, HTTP/SSE framing,
actual MCP mutation flows and fault/recovery paths. A dedicated gateway CI step
builds the standalone Rust executable and requires the real browser/MCP tests;
missing gateway cannot silently skip those acceptance checks. These checks do
not establish atomic visible execution, a real 20-minute human session, native
GPU performance, camera accuracy or enjoyment. The guided deck and blind human
evaluation remain separate protocols.
