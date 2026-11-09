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

## Sources

- [IPN Hand](https://gibranbenitez.github.io/IPN_Hand/)
- [HandS alignment and assets](https://github.com/GibranBenitez/IPN-hand/blob/master/README_HandS.md)
- [Laya-MLX](https://github.com/mizorewww/laya-mlx)
- [Jev models](https://docs.typesafe.ai/models), [experimental images](https://docs.typesafe.ai/images)
- [MediaPipe hands](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- [Lamport causal ordering](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
