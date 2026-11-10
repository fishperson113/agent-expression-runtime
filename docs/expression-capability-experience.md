# Expression capability experience

Fisch is an expression engine that an external agent can use as a visible body.
The user's VTuber-model analogy describes adding expressive capabilities to an
agent, not building a complete AI character platform. The external agent owns
conversation, reasoning, memory and its existing text/voice input. Fisch supplies
the bounded expression tools, observation link, runtime and visible execution.
It does not score people for hiring or interviews, infer emotions from geometry,
or claim another product's capabilities or identity.

The next experience gate is whether an external agent can express meaningfully
while its ordinary conversation remains usable. A classifier may help decide
when to attend; it is optional and default-off. Failed Laya/GLiNER trials do not
block agent-authored expressions, and abstention alone is not useful expression.
See [classifier evidence](classifier-evidence.md) and
[GLiNER limits](classifier-gliner-experiment.md).

## Priorities and acceptance requirements

These requirements define acceptance work, not assertions that a complete
experience has passed. User intent and safety remain authoritative on every path.

| ID | Required capability and concrete check | Evidence / remaining gate |
|---|---|---|
| EXP-01 | An external agent can discover and use the existing expression contract with camera, reactive provider and classifier off. Ordinary input and a second turn remain usable. | Existing MCP tests and relay regression below; actual model tool choice and expression quality remain pending. |
| EXP-02 | Observe/abstain does not disable the external agent's conversation or expression tools. Camera gestures and a separate chat panel are not prerequisites. | Absent/observe-provider relay regression; tool execution and interface usability have separate gates. |
| EXP-03 | User intent passes the existing browser revocation barrier before forwarding to the external agent. Interrupt/cancel must not revive abandoned reactive actions. Stop All ends Live; fresh use then requires an explicit restart/new epoch. | Input-barrier and pending-provider relay regressions; live integration review pending. |
| EXP-04 | Observation starts only with explicit consent. Camera off ends capture and revokes its dependents while ordinary agent interaction remains available. Stop All closes Live/relay and may close its Native UI. | Existing source/causal tests; physical camera stop/recovery pending. |
| EXP-05 | External agents author bounded shapes, colors and motion through tools. The familiar face is an available default symbol, not a restriction on form. A user correction takes precedence; no phrase/gesture-to-effect table replaces interpretation. | Compiler, ownership and playground tests; contextual appropriateness requires human review. |
| EXP-06 | During an enabled observation session, an authorized reactive actor may choose a bounded relevant expression or observe. A gesture need not cause an expression, and new world state continues during inference. | Synthetic observer evidence exists; useful spontaneous expression remains unaccepted. |
| EXP-07 | An external agent can request quiet watching, a different creative direction or recovery through supported controls. Tracking loss, revoke and reset must not replay old effects. | Cancellation/recovery tests; real agent interpretation and human control experience pending. |
| EXP-08 | Input, memory and voice remain external. Existing Codex voice input, if available and authorized, shares its user-intent path; text remains usable. | No new STT/TTS, frontend microphone, conversation brain or voice backend in this scope; actual voice acceptance pending. |
| EXP-09 | Tools, observation actors and execution retain their capability boundaries and trace lineage. Camera events do not silently become native coding turns or toolOutput context injection. | Relay/privacy and causal tests; no new actor permission is granted here. |
| EXP-10 | A 12–20 minute formative external-agent session assesses whether expression helps communication without disrupting control. | Human session pending; timer completion, hashes and synthetic pass are not quality scores. |

First preserve tool discovery, expression execution and ordinary external input
with optional perception/classification absent. Then evaluate the connection
between actual conversational context, agent-authored expression and user control.
Keep classifier comparisons subordinate to this capability gate. Existing MCP,
compiler and gateway contracts remain the implementation boundary; this document
adds no new dialogue protocol or platform.

The current integration uses existing Codex input and conversation. The separate
camera observer is a data-only actor without coding history or coding tools.
This plan neither merges those contexts nor gives a classifier authority to
speak, execute tools or render effects. Reconcile the existing cumulative model
ledger and approved provider configuration before any new hosted-model trial.

## Formative external-agent session: 12 minutes, extendable to 20

Use a consenting person and an external agent already configured with Fisch's
existing tools. Keep raw media and conversation recording off. Record only
consented nonidentifying outcome notes, relative times, interruptions, recovery
and optional feedback; do not retain literal conversation or voice audio. If a
real person/model is unavailable, mark the human session pending rather than
substitute a scripted test or video replay.

| Phase | Approximate duration | Person/agent interaction and observation |
|---|---:|---|
| Ordinary input, visible body | 2 minutes | With camera off, the person chooses a topic in the external agent's normal text input or existing voice input if available. Check that Fisch tools remain discoverable and ordinary interaction needs no camera/classifier/chat-panel setup. |
| Free expression and correction | 3 minutes | Continue conversation freely; optionally co-create through existing expression/playground tools. Let the person choose colors, forms and direction freely. The external agent authors expressions rather than selecting canned gesture effects. Record contextual relevance, visible continuity and response to a correction. |
| Optional observation link | 2 minutes | Offer observation without pressure. If declined, continue camera-off and mark this part skipped. If enabled, allow natural motion and an unprompted quiet gap. Record relevant spontaneous expressions, abstentions and intrusive repetition; never demand one effect per movement. |
| Interrupt and recover | 2 minutes | Use the ordinary turn interrupt/cancel, change direction and turn the camera off if enabled. Send a fresh request through the external input; verify no stale effect returns. Camera off is distinct from Stop All, which closes Live/relay and may close its Native UI. If Stop All is tested, explicitly restart with a new epoch before continuing. Permission or recovery failures take priority over finishing. |
| Quiet watching and feedback | 3 minutes | Let the person request quieter expression or continue interacting as preferred. Ask whether the body clarified anything, distracted them or ignored a correction. Preserve uncertainty and early exits; silence does not automatically mean consent, disinterest or success. |

Extend by up to eight minutes of uncoached conversation, creative remix or quiet
watching, chosen by the person. Offer the [guided deck](guided-play.md) only when
ideas are wanted and label its use guided. Skipping voice, camera or creativity
is valid. Never auto-submit prompts or provide expected effects to manufacture
successful expression.

The report states actual duration, external agent/integration version, enabled
modalities, guided versus uncoached phases, tool/application failures, recovery
outcomes and optional feedback about relevance, timing and control. Keep
annoyances and missed opportunities alongside successes. Actual conversation
coherence is assessed as external-agent integration quality; Fisch is not a new
conversation brain. Human acceptance remains pending until performed and reviewed.
No numerical naturalness, retention or satisfaction threshold is invented here.

## Structural regression and limits

`tests/live-reactive-terminal.test.mjs` uses the real authenticated loopback relay
with a scripted app-server and fake Native client. New absent/observe-provider
cases hold the browser intent barrier, verify input has not reached the Native
server, release it, receive a scripted assistant delta, interrupt, and forward a
second user turn intact with a distinct turn ID and assistant delta. The existing expression instruction bundle and Live
environment remain present. No camera data creates an extra native turn or
injected toolOutput. The absent case supplies no observation candidate; the
observe case supplies only a synthetic typed window. Neither opens a physical
camera or a chat panel.

This establishes route availability, preserved capability instructions, two-way
message delivery and priority ordering. It does not execute a new expression or
prove tool discovery by a real model: existing MCP/compiler integration tests
cover execution separately. A canned delta is not conversation coherence, and
a page fixture is not usability evidence. No hosted model, physical device,
voice, GPU, human enjoyment or 12–20 minute session is certified by these tests.

## Capability discovery and execution regression

External hosts can read `aer://capabilities/v1` for the full shared limits and
`aer://workflow/v1` for ownership, feedback and recovery. Read
`aer://instructions/v1` and the discovered tool schemas before authoring work.
`expression_status({requestId})` reads this MCP process's bounded journal of its
own commands. Its subscription starts before dispatch, so early renderer
feedback can be correlated after the admission receipt arrives. Reads never
create/reconnect a session or replay work. Missing, expired or interrupted
feedback remains unknown; a cancel ACK alone is not renderer cancellation.
The visibility field remains unknown because generic gateway feedback does not
carry raster evidence. Applied and completed must not be described as visible.

`tests/expression-capability-e2e.test.mjs` exercises actual stdio MCP discovery,
the Rust gateway and the Live browser renderer with camera off. A scripted
external client authors three arbitrary RGB/motion programs, verifies terminal
execution feedback and idempotent resubmission, rejects malformed color,
interrupts active work and recovers with an explicit new request/epoch. Numeric
WebGL pixel reads and shader values independently verify rendered color; these
are separate from `expression_status`. The required gateway CI job runs this
test without allowing a missing binary to turn it into a skip. It uses software
WebGL in Cloud and no model calls, personal media or voice services.

Native relay/input tests and this MCP execution test cover different integration
boundaries. They do not prove that Codex or Claude actually discovers tools or
chooses a relevant expression during a real conversation. Hosted-agent evaluation
still needs the existing budget ledger/provider configuration reconciled; the
human session above remains pending.

### Composite Live completion

A Live receipt completes after both its scheduler program and configured work
end (pose end times, or the lease for continuous controls). Empty configuration
does not extend completion. Epoch cancellation or configuration replacement before then emits cancelled,
even when the scheduler program has already finished. This aggregation does not
extend scheduler ownership or block local controls. Plain program completion
continues to describe its scheduler timeline; retained geometry or a part motion
period is not a promise that the expression stayed visible for that duration.
Neither status nor requested duration proves elapsed rendered time or visibility.
