# Fisch proactive interaction: PRD and SRS

Design baseline: 2026-11-09, main `0bca491c0b11a407d109f1b2579adf465afeb2a0`.
Status: implementation in increments; requirements below are targets, not acceptance claims.

## Product requirements

Fisch is an optional observing creature. Camera starts off and requires consent.
The face is its default communication identity; bounded agent-authored geometry may
replace it. Chat is optional. Existing Codex voice input shares user intent; no voice
frontend, STT or TTS is introduced. Fast local perception/reflex work never awaits a
model. A slower semantic loop may express or abstain, while newer world state keeps
flowing. Natural-language keywords must not select canned effects.

A useful demo shows idle, explicit observation start, smooth response to a moving
hand, an optional semantic reaction, and continued local motion during a delayed
model turn. Withdrawing the hand, user input, stop or seek must invalidate dependent
work. Trace inspection explains which evidence produced and authorized each action.
Public licensed replay supports Cloud development without recording a real user.
Replay proves neither physical-camera performance nor subjective naturalness.

Desktop experience targets a 2:1 scene/control layout with accessible narrow layouts.
Raw webcam stays local, recorder defaults off, and structured observations alone
may enter the already authorized provider path. Arbitrary model code, filesystem,
network tools and emotion/identity inference are outside the reactive capability.

## Baseline and module map

Historical inventory at the design baseline SHA above. This table is preserved as
the starting point; the phase-two status below records subsequent implementation.

| Area | Existing implementation | Gap / planned increment |
|---|---|---|
| Perception | `src/live/vision.worker.ts`, observation adapter | Hand summaries exist; structured landmarks discarded before bridge |
| Wire/store | `src/core/live/observation.ts`, Rust `live_observation.rs` | Version 1 face snapshot; add optional validated hand contract |
| Local control | `src/core/live/compositor.ts`, bounded compiler/DSL | Preserve existing DSL; full track-aware leases remain future work |
| Slow loop | `integrations/live-reactivity.mjs` | 750 ms coalescing, 15 s cooldown, four starts/rolling minute, 30 s watchdog; inspect burst starvation and callback ownership |
| Trace | `src/core/live/trace.ts` | 64 proxy records; no full causal bundle or particle trajectory |
| Provider | `integrations/live-codex-transport.mjs` | Same-thread reactive trigger correctness under investigation |
| Chat | Draft PR #51 | CI green does not resolve unrelated autonomous Vnstock/Python output; do not merge |

## Requirements and invariants

| ID | Requirement | Verification / acceptance |
|---|---|---|
| OBS-01 | Preserve structured hand geometry, confidence, handedness and coordinate semantics across TS/Rust | Full 21-landmark round-trip; malformed/nonfinite/unknown versions rejected |
| OBS-02 | Separate unavailable, lost and tracked; do not label relative z as physical distance | Contract fixtures and stale-clear checks |
| OBS-03 | Stable track identity, mirror/rotation/crop metadata and primary-hand hysteresis | Symmetric/multiple-hand fixtures; not satisfied by handedness slots alone |
| CLK-01 | Timeout/cooldown use host monotonic time, media keeps PTS and origin | Clock-jump and VFR fixtures; wall clock only log correlation |
| CAU-01 | Request carries session, epoch, source sequence, trigger IDs, basedOn/readSet, intent/controller revision, deadline | Serialized contract tests and trace linkage |
| CAU-02 | New compatible frame alone must not invalidate a decision; changed dependency must | Same-track motion accepted, lost track/user intent rejected |
| CAU-03 | Stop/reset/seek/revoke wins before dispatch and after every await | Delayed/duplicate callback race tests |
| SCH-01 | Finite coalescing, one latest pending candidate, one apply owner; bounded queues | 100-event burst; no starvation or backlog |
| SCH-02 | Four dispatches in rolling 60 s, 15 s from dispatch cooldown; every sent turn counts | Fake-clock boundary/cancel/error tests |
| SCH-03 | 30 s watchdog revokes authority; transport uncertainty blocks new dispatch | Late callback/cancel unknown/disconnect tests; no blind retry |
| ACT-01 | Existing strict declarative DSL only; validate entire program before dispatch | Unknown primitive/script/NaN/bounds tests |
| ACT-02 | One owner/channel/tick, bounded transition from current state, action IDs idempotent | Arbiter race and duplicate delivery tests |
| USR-01 | User intent outranks reactive action; Codex voice/chat use one deduplicated path | User-during-reactive tests; no new voice frontend |
| REP-01 | Control replay uses fixed timestep/seed/config, no model/perception calls | Three identical same-runtime trajectory hashes |
| REP-02 | Video replay preserves PTS; model re-evaluation is separately budgeted | Explicit mode manifests; VFR/discontinuity tests |
| REC-01 | Bounded scrubbed trace with manifest, lineage, execution and trajectory | Quota/write-failure/corrupt-tail tests; incomplete flag |
| PRI-01 | Default camera/recording off; stop ends capture and revokes authority | Browser permission/revoke tests |
| PRI-02 | No real-user media in artifacts; no dataset media sent to providers | Artifact inventory and network audit |
| DAT-01 | Every dataset clip pins source, license, split, version, checksum, boundaries | Manifest audit; subject/source split isolation |
| EVAL-01 | Separate perception, orchestration, naturalness and physical-device evidence | Report explicitly identifies mode, runtime, sample count and open gates |
| BUD-01 | Enforce the separately authorized cumulative model-test budget | No calls until durable ledger/deadline reconciled; uncertainty never zero usage |

All callbacks must check current generation. Terminal requests never return to
inFlight. A timeout removes logical apply rights, not necessarily provider cost or
transport activity. An orphan registry must remain bounded; default policy forbids
another reactive transport until completion is confirmed. Observe is a successful
semantic abstention, not an automatic retry trigger.

## Versioned contract and API evolution

Current observation wire version is `v:1`; an additive optional hand extension must
carry its own version, fixed landmark count/index order, finite normalized x/y,
relative model z, source dimensions and explicit mirror semantics. Old clients may
omit it. Unknown hand versions fail closed. TS and Rust validate the same boundary;
a summary never substitutes for numerical fields. Absence/stale clearing must not
leave a previous hand alive. Stable temporal identity is a separate requirement.

The target causal schema version 1 is an envelope with `sessionId`, `epoch`,
`eventId`, `sourceId`, monotonic per-source `sourceSeq`, `kind`, `timebase`,
`capturedAt`, host-monotonic `receivedAt`, and bounded `payload`. Media adds PTS,
frame index, duration, dropped count and discontinuity. Cross-source timestamps
alone do not establish causality. Requests add `requestId`, `basedOn`, semantic
`readSet`, intent/controller revision, deadline, config/prompt hashes, capability
set and budget reservation. Decisions bind request and input IDs, observe/express,
prerequisites, expiry and validated existing actions. Execution records state
accepted/rejected/started/completed/cancelled and finite state/hash plus ownership.
This target envelope is not asserted to be fully implemented by the additive hand
increment. Breaking versions require rejecting incompatible bundles or coordinated
reader/controller rollback, never silently interpreting newer payloads.

## Scheduler state machine

`disabled -> idle -> coalescing -> queued -> inFlight -> validating -> applying -> cooldown`.
Enable creates a new epoch. Coalescing is a finite window from first eligible event;
subsequent evidence replaces the candidate without postponing forever. Dispatch
reserves budget and ownership. Model completion atomically validates dependencies
and acquires channels. Continuous tracking actions resolve current compatible
track position. Snapshot actions declare short TTL. Stop/user/revoke transitions
remove authority immediately. Request terminals are completed, cancelled,
timedOut, failed or unknown. Late results are audited and dropped. Pending events
expire rather than accumulating work to replay after cooldown.

## Privacy, assets and retention

Recorder remains off until TTL/quota/delete controls exist. Proposed retention
(24 h opt-in raw recordings, seven days debug traces) is not an approved or
implemented policy. Keep inputs and identifying landmarks in private ignored
cache, never Git. Shared bundles exclude credentials, prompts, raw audio/video and
unnecessary transcript. License to download is not authorization to upload to a
model. Revoke ends capture, not merely the status indicator.

IPN Hand/HandS is the first candidate: CC BY 4.0 must be checked on actual assets.
HandS annotations use the corrected original-video timeline, 640x480, 30 fps,
1-based inclusive frame bounds. Conversion is `[start-1,end)`; do not mix old
near-duplicate-removed annotation with original video. Preserve real PTS mappings
and report discrepancies. Start with a small dev set; freeze source/subject-separated
holdout before tuning. No fish trajectory ground truth is supplied by gesture labels.
RAVDESS noncommercial/share-alike restrictions exclude implicit commercial release;
EgoGesture agreement excludes automatic download. Unclear rights stop that asset,
not independent fixtures/code.

## Implementation and release plan

1. M0 pin baseline, gap matrix, schema and threat boundaries; no model calls.
2. M1 preserve and validate hand observations; fake delayed model proves local independence.
3. M2 finite scheduler, causal/read-set validation, leases, orphan handling and user priority.
4. M3 deterministic control replay then full recorder/lineage, PTS video adapter and bounded retention.
5. M4 verified licensed subset, perception replay, frozen rubric and budgeted model ablation.
6. M5 scene/controls layout, explicit camera lifecycle, opt-in rollout and human/device demo.

Each increment stays within harness limits and has a focused PR, tests and rollback.
Structured observation, causal validation, reactive model, recorder, replay and debug
UI need independent flags; recorder off. No merge of PR #51 until its autonomous
content blocker is substantively resolved. Passing CI alone is insufficient.

Cloud checks: `npm test`, `npm run build`, `npm run check:architecture`,
`python3 scripts/check-harness.py`; Rust gateway uses locked no-default-features
check/test. Default desktop checks may need platform prerequisites and must be
reported separately. Browser performance tests run serially without competing loads.

Targets (not measurements): local response proxy p95 <150 ms, 24 Hz local updates,
<100 MB growth over 30 min in a named memory metric, human score >=6/10. Record
sample count, warm-up, renderer/hardware, p50/p95, jitter, dropped frames, stale
reasons, false triggers, orphan count and usage uncertainty. Repeated negative
clips are stress, not independent evidence. Physical capture-to-photon and human
naturalness remain blocked without target hardware/participants.

## Optional decision models

Laya-MLX is an MLX port of typed decision models for Apple Silicon/macOS, not a
video/gesture detector; it is unsuitable as the Linux Cloud default. Jev is hosted,
with experimental image/Box support; no new API, purchase or media upload is
implicit. First compare deterministic/MediaPipe features with a tiny classifier.
Either decision model could later gate ambiguous structured events with version,
TTL and abstain semantics, never own world-state truth or enter the local fast path.
Evaluate precision/recall, negative-minute false triggers, p95 latency and stale rate
on a frozen split before integration. No such model benchmark has run here.

## Phase-two implementation status — 2026-11-09

Inspected snapshot: main `eef7ed9d930ac8539ef26e588ee2bca70be49212`.
The original requirement tables and baseline inventory remain the design contract;
this update distinguishes implemented boundaries from remaining acceptance work.
Code/test references identify implementation and regression coverage, not fresh
production-model, hardware, performance or human-quality verification.

The separate observer is a stateless, data-only Responses request with `store=false`,
`tools=[]` and `tool_choice=none`. It receives a bounded validated observation
window with summaries removed, not Native conversation history or a coding thread.
Returned data must pass the existing finite DSL compiler and browser admission
barriers. This boundary adds no model-selected command, filesystem, network or MCP
tool capability and uses no natural-language keyword-to-effect table.

The provider factory defaults off. Explicit dedicated backend/model/endpoint
configuration and the absolute path to an **existing approved cumulative budget
ledger** are required. Startup validates expiry/capacity; an atomic reservation
rechecks the same ledger before each request. It never creates or resets a ledger,
extends its deadline or grants additional turns. Missing authorization, exhausted
budget and transport uncertainty do not become free retries. This document records
no new remote agent model requests and does not assert that a usable ledger or
provider credential is currently available.

The browser uses a **five-second semantic request deadline** and action validity
bounded by that deadline. Its execution lease can expire and revoke before the
Node broker's separate **30-second transport watchdog**. The watchdog concerns
unsettled transport, abort and uncertainty; it does not extend scene authority or
prove that provider processing/cost stopped. The broker also bounds browser calls
to ten seconds and fails closed on browser unavailability.

| Requirements | Implemented boundary and regression references | Remaining scope / acceptance |
|---|---|---|
| OBS-01, OBS-02 | Versioned optional hand fields survive TS/Rust validation; finite 21-point geometry, handedness/confidence and source/relative-z semantics. `tests/live-observation.test.ts`, Rust `live_gateway_tests.rs`. | Real perception quality is separate from serialization correctness. |
| OBS-03 | Conservative geometric `HandTracker`, bounded short-loss continuity, primary-hand hysteresis and hand signals; `tests/live-hand-tracker.test.ts`, `tests/live-hand-signals.test.ts`. | Identity through crossing/occlusion is not established; general rotation/crop/calibration metadata remains incomplete. |
| CLK-01 | Injected browser monotonic clock drives coalescing, deadlines and leases; broker transport timers are separate. `tests/reactive-session.test.ts`. | Existing observation freshness still uses wall-clock `capturedAt`; the generic clock-origin/mapping contract is not fully implemented. |
| CAU-01, CAU-02 | Requests bind session/epoch/request ID, intent/presence revisions, deadline and required tracks. Compatible frames remain admissible. Broker freezes and compares the complete outer/window request before authorization. `tests/live-decision.test.ts`, `tests/reactive-session.test.ts`, `tests/live-reactive-broker.test.mjs`. | This is a specific track-membership/presence read-set, not generic field-level `basedOn/readSet`, controller/config/prompt hashes or a complete common envelope. |
| CAU-03, ACT-02 | Consume-once dispatch authorization, revocable execution leases, per-tick checks and no-advance scheduler cancellation; owner-scoped cancellation precedes the next scheduler tick. `tests/reactive-lease.test.ts`, `tests/live-reactive-body.test.ts`, `tests/live-reactive-browser.test.mjs`, `tests/core.test.ts`. | General multi-channel ownership/blending and full revoke-scope contracts are not certified. Seek/source-clock behavior needs the full replay integration. |
| SCH-01, SCH-02, SCH-03 | Finite 750 ms coalescing, bounded history/receipts, one transport slot/owner, 15 s cooldown and four starts in a rolling minute. Browser revocation retains unresolved transport; Node watchdog/unknown outcomes block further dispatch. `tests/reactive-session.test.ts`, `tests/live-reactive-broker.test.mjs`. | No claim of a general orphan registry, provider settlement proof or optimal tuning. Browser capacity requires an explicit reconciled lifecycle restart. |
| ACT-01, PRI-02 | Fixed tool-free provider request, strict bounded output and shared compiler validation; complete request binding and final browser preflight. `tests/reactive-provider.test.mjs`, `tests/live-reactive-broker.test.mjs`, `tests/live-reactive-body.test.ts`. | Provider deployment/access approval and actual semantic behavior remain unverified; these tests are not privacy acceptance for every launch/runtime. |
| USR-01 | `LiveBody.admit` crosses `prepareUserMutation` before compilation. Configuration leases survive IR completion; non-avatar user geometry remains protected until explicit return/reset. `tests/live-reactive-body.test.ts`. | Voice/chat deduplication and every future co-create mutation must continue through the shared barrier; no new voice frontend exists. Terminal broker integration remains pending PR #74 at this snapshot. |
| REC-01, CAU-01 | `SceneTrace` records bounded `native/reactive/ambient` attribution plus validated request/decision/action IDs. Native lifecycle receipts alone reach the gateway, even when local epoch/sequence values collide. `tests/live-trace.test.ts`, `tests/live-reactive-body.test.ts`. | This is a bounded lifecycle/frame-hash proxy, not the full manifest/observations/events/execution/trajectory recorder, durable audit, retention or write-failure recovery contract. |
| REP-01, REP-02, DAT-01 | Engineering replay/experience fixtures and licensed public-video decode provide separate local evidence inputs; see `docs/public-video-replay.md`, `tests/experience-replay.test.ts`, `tests/public-video-replay.test.mjs`. | Full deterministic production controller replay, VFR/seek integration, frozen subject-separated annotated evaluation and model re-evaluation remain separate work. IPN HandS integrity discrepancy is not resolved by another licensed fixture. |
| PRI-01, EVAL-01, BUD-01 | Camera and reactive provider remain opt-in; browser source/visibility/stop hooks revoke reactive authority. Budget factory tests cover default-off, expired/exhausted ledgers and atomic final reservation. `tests/live-reactive-browser.test.mjs`, `tests/live-reactive-provider.test.mjs`. | No physical-device, live-production-model, sustained UX or human-naturalness acceptance. Recorder/retention proposals above remain unapproved and unimplemented. |

Implementation milestones represented in this snapshot:

- [PR #64](https://github.com/fishperson113/agent-expression-runtime/pull/64): execution leases, `reactive-lease.ts`, compositor release and lease regressions.
- [PR #66](https://github.com/fishperson113/agent-expression-runtime/pull/66): stateless data-only adapter and strict request/output boundary.
- [PR #67](https://github.com/fishperson113/agent-expression-runtime/pull/67): scheduler cancellation without advancing a revoked program one last time.
- [PR #68](https://github.com/fishperson113/agent-expression-runtime/pull/68): bounded Node/browser broker and user-input revocation barrier.
- [PR #69](https://github.com/fishperson113/agent-expression-runtime/pull/69): browser coordinator, finite gating and consume-once dispatch authority.
- [PR #70](https://github.com/fishperson113/agent-expression-runtime/pull/70): browser body/main/bridge wiring, user geometry ownership, legacy-path quarantine, preflight part checks and lifecycle provenance.
- [PR #71](https://github.com/fishperson113/agent-expression-runtime/pull/71): explicit opt-in factory using the existing approved ledger and dedicated environment filtering.
- [PR #73](https://github.com/fishperson113/agent-expression-runtime/pull/73): full outer/window request binding before provider authorization.

The old browser `reactivity()` polling API is removed at this snapshot, preventing
the legacy polling integration from starting automatic camera turns in Native.
`LiveReactivity` remains legacy code, not the new observer's authority mechanism.
[PR #74](https://github.com/fishperson113/agent-expression-runtime/pull/74), reviewed
as pending at head `e1a8cd8c337f0d3c22750dd7241f8e13e6afcf22`, proposes replacing
terminal camera routing with `LiveReactiveBroker`, stripping dedicated observer
configuration/credentials from both Native child environments, and awaiting the
browser user-mutation barrier before forwarding controlled Native input. It is
**not included** in the inspected main SHA and is not a merge/rollout claim.

The historical autonomous Vnstock/Python content still has **unknown provenance**.
[PR #51](https://github.com/fishperson113/agent-expression-runtime/pull/51) remains
open/draft at `0120aa1120c7f8a98f05ec66f776e8985aef7d98` when checked for this update.
Removing the legacy camera entry point and introducing an isolated observer does
not retroactively explain that output or establish autonomous-quality acceptance.
No full envelope, recorder, live-model, human or naturalness gate is marked done.

## Sources

- [IPN Hand](https://gibranbenitez.github.io/IPN_Hand/)
- [HandS alignment and assets](https://github.com/GibranBenitez/IPN-hand/blob/master/README_HandS.md)
- [Laya-MLX](https://github.com/mizorewww/laya-mlx)
- [Jev models](https://docs.typesafe.ai/models), [experimental images](https://docs.typesafe.ai/images)
- [MediaPipe hands](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- [Lamport causal ordering](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
