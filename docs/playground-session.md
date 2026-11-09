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

## Finding co-creation in the Live interface

The body panel has a collapsed **Cùng sáng tạo** entry. Enter an idea and, if
useful, a short optional goal; copy a create or remix request and paste it into
the current Codex terminal. Undo, return to the first saved version and explicit
recovery have their own copy actions. Copying does not send a turn, invoke a
model or modify the body. If clipboard access fails, select and copy the displayed
request manually. Ideas, goals and generated request text stay in ephemeral DOM
state; selecting a different Codex thread clears them.

Codex discovers `playground_state` and `playground_edit` through the same Live MCP
configuration as ordinary expression tools. The interface shows a redacted
projection of actual tool lifecycle events from the selected thread and turn:
working, saved revision/history count, interrupted or uncertain. It reads only
the fixed operation enum from tool arguments and bounded result metadata; it
never forwards scene geometry, goals or other arguments to that projection.
“Saved” describes the committed journal, not the current pixels: an ordinary
temporary expression can still change the visible body. Interrupted or uncertain
work needs a fresh state read; recovery explicitly revokes old ownership and clears history. An
ACK-only Native turn can establish projection ownership through the host’s
correlated turn/start response; it cannot establish a saved creation. A gateway
admission ACK correlated to the owning session, epoch and sequence also does
not establish completion: the actual tool result must confirm both body and
baseline completed before the journal is shown as saved.

The launcher-route test replaces Native Codex and its app-server with a named
scripted test double. It preserves CLI dispatch, Live launcher, authenticated
terminal relay, configured MCP discovery, actual MCP process, Rust gateway and
browser. Scripted choices are supplied by the test, so this establishes transport,
application and recovery behavior; it does not establish that a real model
understands arbitrary requests or that a person enjoys a 10–20 minute session.
No real camera, microphone or model is used by these tests. Human evaluation
remains pending. Any real-model verification must use reconciled usage within
the existing authorized model budget.

After building the standalone gateway and installing Chromium, Linux/Cloud can
reproduce the optional scripted 10-minute route soak with:

```sh
FISCH_PLAYGROUND_REQUIRE_GATEWAY=1 FISCH_PLAYGROUND_ROUTE_SOAK_MS=600000 npx vitest run --maxWorkers=1 --disableConsoleIntercept tests/playground-route.test.mjs
```

A 120-second stillness window sends no Native turns between its before/after
state reads; browser-only checks monitor saved part identity, an empty scheduler
queue and camera-off state. Repeated remixes then check actual tool completion,
UI revision and rendered part IDs. Final state must have no pending work or recovery requirement. The summary contains elapsed
time and counts only; it does not log scenes, goals, prompts or credentials.
