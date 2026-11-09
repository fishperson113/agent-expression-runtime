# Fisch Live cloud execution — 2026-11-08

T0: 2026-11-08 16:41:03 UTC. Hard deadline: 22:41:03 UTC.
Real Fisch model test budget: 120 turns including retries/evaluation; used: 2.
Completed real holdout turns: 0 (service policy blocked).
Authoritative counter and transient reports: `.runtime/live-overnight/`.
Owner's personal machine is off; all new evidence is cloud Linux only.

Baseline fetched: main `3f7b911`. Initial working tree clean. Fresh branch:
`codex/live-terminal-host`. Existing project instructions and historical evidence
remain intact. Latest owner assignment supersedes Herdr-only Live launch.

## Checkpoint 0 — preflight

Cloud connected/running, configuration observations current; Git fetch and prior
GitHub PR/merge access verified. Node 24.22.1, Python 3.12.14, Chromium and Rust
installed. Codex CLI 0.167.0-alpha.4 reports ChatGPT login; real inference not yet
verified. App-server schema generation works. No Herdr or personal camera needed.
GTK/WebKit development libraries and supported privileged package installer are
absent in this image; native gateway compilation is initially blocked. Investigate
gateway-only compilation without requiring a desktop UI, preserving Tauri mode.

Hypothesis: launcher unconditionally queries Herdr and semantic expression is
optional; default Live body is the scheduler's sphere. Test host-independent
launch and face initialization before implementing. Evaluate official app-server
stdio lifecycle/deltas instead of inferring replies from terminal repaint text.

Next: baseline regression/browser capability, real Codex capability probe, failing
terminal-host test; implement the smallest supported host adapter. Preserve final
verification window beginning 21:41 UTC. Do not start new model work at deadline
or counter limit. Human recognition, real-person accuracy, physical camera,
Windows GPU/Herdr and Vietnamese /voice remain pending regardless of cloud tests.

Acceptance targets retained: 24 Hz vision, <150 ms confirmed-event reaction,
>=30-minute stable soak with <100 MB retained growth, actual-person observation
accuracy >=8/10 and human theme recognition >=6/10. Proxy results are separate.

## Checkpoint 1 — gateway isolation

Baseline: 220 JS tests passed, 2 skipped / 41 files. Installed system Chromium
was used via a local Playwright executable layout: downloading Playwright's
browser was explicitly denied by network policy. This is headless/software
evidence, not native GPU acceptance.

Red test: locked Cargo check for `fisch-gateway` failed because no such binary
existed. Added an optional desktop feature and a gateway-only binary sharing the
same Rust transport and tests. Green: all 16 Rust tests, gateway build, frontend
build and architecture checks pass. Desktop remains the default Cargo feature;
Windows CI continues exercising it. Added Linux gateway CI.

Real-model counter: 1/120. A real Codex text probe timed out at 90 seconds.
App-server initialize/thread-start succeeded without inference, but its service
connection failed. Asset fetch to storage.googleapis.com was explicitly denied
(HTTP 403 Domain forbidden). No retry through alternate routes or real camera.
Native GTK installer unavailable; gateway-only build removes that dependency
for browser mode instead of altering system privileges.

Next: ordinary-terminal adapter with official stdio events; camera assets must
not prevent camera-off startup. Real model/holdout gates stay blocked until
authorized Cloud network access exists. Deadline unchanged: 22:41:03 UTC.

## Checkpoint 2 — normal-terminal path

Official app-server protocol reviewed at https://learn.chatgpt.com/docs/app-server
and matched against generated CLI schemas. Selected stdio app-server behind an
authenticated, single-client loopback relay for the existing Codex CLI remote
interface: no replacement chat UI. Only agent-message delta notifications drive
reply rhythm; tool/spinner output does not. Thread instructions are appended to,
not substituted for, existing developer instructions. No global settings edited.

Red: no-Herdr launch failed at unconditional session.snapshot. Added explicit
host discovery with terminal cwd fallback and retained the Herdr adapter. Green:
9 focused launcher/output/relay tests including stale-turn rejection, 600 ms
decay, instruction preservation, unauthorized relay rejection and real stdio
roundtrip through a deterministic child fixture. Architecture/build passed.
Actual Cloud Codex TUI opened next to a paired headless body with HERDR_* absent;
it remained service-blocked, so no semantic/model success is claimed. Ctrl+C
closed owned CLI/server/browser/gateway. Camera-off startup now tolerates absent
camera assets instead of blocking the entire conversation workflow.

Counter 2/120: one timeout plus one conservatively counted queued /quit input
during TUI smoke (interrupted, no successful model reply). No model holdout run.
Cloud proxy explicitly returns 403 for chatgpt.com; do not retry around policy.
Next: readable face, declared controls, scene/application trace and visual tests.

## Checkpoint 3 — visible face and restoration

Added declared curve/ellipsoid face geometry with explicit role metadata and
data-defined lifecycle controls. No prompt/keyword-to-shape mapping. Face gestures
and illustrations remain agent-authored via existing bounded DSL; return_to_face
restores declared geometry and clears semantic controls. Initial static face is
compiled/rendered before starting its frame loop, including reduced/off mode.

Red/green: missing face module first; then a wire-order regression reproduced a
real browser failure. Gateway serialization reordered object keys: rendering
restored the facial geometry but identity detection did not activate its controls.
Canonical structural comparison now handles wire ordering, with a failing-then-
passing test. MCP -> gateway -> compiler -> WebGL screenshots show idle, working,
replying, waiting, a bird fixture and restored face. Images visually inspected;
zero page errors. Short restored sample ~60 FPS, p95 ~17 ms is software rendering
only, not a sustained performance certificate. No model-authored semantic result
is claimed: these are explicit deterministic fixtures.

Eight focused face/browser/tool tests pass, including motion-off pixel freeze,
camera-off rendering and control behavior. A broader regression is next. Actual
model gate remains blocked (2/120 used). PR #22 passed detailed core, Windows and
Linux gateway CI and merged as d0fa594. An initial merge auto-review denied missing
head/CI evidence; after reading owner authorization and fresh completed job data,
the protected retry succeeded. PR #23 was retargeted to main (10 aggregate files)
and strengthened with owned process-group/pipe cleanup and a process-exit test.

## Checkpoint 4 — attribution and synthetic stability tooling

Added a 64-event camera-free trace separating received/admitted/rejected,
scheduler applied/completed/cancelled, renderer frame submission and geometry
hash change. The last two remain explicit proxies, not content relevance or
human recognition scores. Trace includes only turn ordinal, numeric sequence,
bounded code and times; no user text, credentials, images or raw tool payloads.
Cancelled work loses its pending frame attribution.

Opt-in synthetic mode exercises present/absent/stale/denied/error observations
through the real aggregator; camera start is disabled and the UI clearly labels
fixtures. Synthetic samples do not certify Face Landmarker throughput. Added
Linux browser-private memory measurement from process smaps_rollup, retaining
unknown/error instead of fabricating zero when unavailable.

232 JS tests passed; build caught a nullable Vite test URL and was corrected.
10-second apparatus check after 60-second warm-up passed with 702 observation
frames, zero external requests/unexpected frames/page errors; private growth
1.03 MB. It is explicitly ineligible for 30-minute acceptance. Run the final
>=1800-second soak only on a stable final build. PR #23 merged as 44dcf3c after
all current-head core/Windows/gateway/harness jobs passed. Model budget remains
2/120; services remain policy-blocked. Deadline stays 22:41:03 UTC.

## Checkpoint 5 — independent resource cleanup

Red tests exposed missing independent cleanup and already-aborted startup
handling. Live now attempts browser, gateway and static-server cleanup even if
one fails; closure is idempotent and abort listeners are removed. Already-aborted
runs open nothing. Real camera-off browser closure stops its owned gateway, with
a native-gateway regression (the agent in that test is a deterministic host).
Herdr discovery now uses the actual HERDR_SOCKET_PATH name, and doctor treats
panel attachment as optional while checking terminal/browser dependencies.

Four lifecycle tests and eight existing terminal/launcher tests pass. Native
gateway/MCP acceptance script passed macro-after-cancel, invalid rejection,
synthetic look/cooldown and browser reload with no script errors. This remains
deterministic tool/renderer evidence, not model behavior. Face PR #24 merged as
c0de611 after current-head core, Windows and gateway CI passed. No new model turns.

## Checkpoint 6 — control ownership and stale-work cancellation

A falsifiable follow-up test reproduced neutral writes retaining channels after
lease expiry. Added bounded weight fade and layer composition so local facial
reflexes regain channels smoothly; no additive DSL or semantic planner added.
Also found the UI cancel was renderer-local: it now quarantines old epochs
immediately and revokes the controller through the authenticated gateway.
Live MCP reports session changes without silently replaying an old gesture;
a subsequent explicit request reconnects and restores accepted macro definitions.
Legacy MCP reconnect behavior remains covered and unchanged.

14 focused compositor/MCP/cancel tests pass. The real gateway/browser regression
starts an eight-second morph, cancels through the UI, verifies the stale request
is not replayed, then returns to the face with a new explicit request. Trace now
includes a validated UUID epoch to distinguish reused sequence numbers across
reconnections, never credentials or arbitrary caller text. Full regression and
final static-build soak follow. Model counter remains 2/120, deadline unchanged.

## Checkpoint 7 — frozen holdout and budget guards

Final soak started on stable runtime f7d91b7 at approximately 17:16 UTC, with
60-second warm-up then 1,800 seconds of synthetic observations and topology/
cancel/resize cycles. No browser-heavy tests or frontend changes during the soak.
At five minutes there are no script errors or off-loopback requests. SwiftShader
samples around 40–44 FPS / p95 38–43 ms miss the performance targets; do not hide
this behind the earlier short face-only sample.

Frozen ten ordinary prompts, two passes, in integrations/live-holdout.json. An
opt-in real app-server driver reserves every request before sending, shares the
existing ignored counter, rejects concurrent writers, and enforces both 120 and
22:41:03 UTC. Counter/deadline/lock and protocol-boundary tests pass. Admission,
application and frame proxies are scored separately; relevance, visual meaning
and semantic consistency remain unscored until actual reviewed model evidence.
Only --describe was run; the network denial was not retried. Counter still 2/120,
zero completed holdout turns. No inference or fake model result is counted as a
passing conversation gate. PR #26 merged as 692332c after all jobs passed.

## Checkpoint 8 — baseline complete; final verification

PR #27 merged as c187f44; model tooling #28 as 8a9afad; XYZ diagnostic sampling
#29 as c9b6364; reserved body-channel correction #30 as 74195ca. Every merge used
current-head successful core/Windows/gateway/harness jobs and expected-head
protection. The model driver remains unexecuted against real inference; its
pure tests cover budget/deadline/lock, stale turns, transport loss and scoring.

Baseline f7d91b7 completed 1,800.115 seconds after 60-second warm-up: zero page
errors, unexpected frames, browser off-loopback/blocked requests; private growth
10,571,776 bytes after GC. Rolling FPS 33.28–57.60 / p95 20.9–53.5 ms miss sustained
targets. It is software-rendered/synthetic-only. No Face Landmarker inference.

Review exposed X-only hash sampling and double application of the reserved body
channel to a part also named body. Both got failing-then-passing pure tests.
A historical source archive under .runtime was accidentally included by Vitest;
moved it to /tmp and reran cleanly: 247 current tests / 48 files, no skips. Do not
report the contaminated 466-pass/two-historical-skip run as current coverage.
TypeScript/Vite build, architecture and 16 shared gateway Rust tests/check pass.

Camera-off comparison from historical 3f7b911 to 992d48c shows sphere -> declared
face -> deterministic bird illustration -> restored face, without page errors.
A fresh 30-minute synthetic soak started on stable browser/gateway 992d48c. No
browser-heavy tests, HMR or frontend changes during the soak. No screenshot is
model-authored; visual review remains an agent proxy rather than human scoring.

## Checkpoint 9 — terminal thread selection

A Node-host review found output stayed pinned to the first thread after ordinary
UI new/resume/fork. A red protocol replay preceded the fix: only the latest
successful explicit UI selection changes tracking; failed/superseded responses,
background notifications and old deltas do not. Relay callback and 15 focused
launcher/model-budget/output tests pass. PR #31 passed current-head core/Windows/gateway/harness CI and merged as
78a3ce8. This correction
changes no code/assets in the running browser/gateway soak bundle.

Next: complete stable soak; clean final regression and functional browser check;
append sanitized evidence/acceptance, merge passing handoff docs, verify main and
clean only this run's preserved branches/jobs. Counter remains 2/120, deadline
22:41:03 UTC unchanged. No network-policy workaround or personal-machine access.

## Checkpoint 10 — physical function-size audit

Manual review found the newly touched outer relay function at 51 physical lines;
the existing heuristic checker did not catch the destructured signature span.
Extracted named bounded-output handling, without behavior changes, line packing,
exemptions or vendored rule edits. PR #32 is one file; 15 focused tests and current-head core/Windows/gateway/
harness CI passed, merged as 9e79030.
A supplementary TypeScript AST audit of all JS/TS changed since 3f7b911 reports
224 touched functions, maximum 40 physical lines, zero violations. Rust touched
functions were checked separately (maximum 18 lines). R10/R11 remain unsupported
in Codex; these direct checks do not change that limitation.

Ten completed runtime branches were deleted locally/remotely only after exact
remote-head and main-ancestry verification, using atomic expected-ref deletion.
Pre-existing branches were untouched. Relay-refactor and handoff branches remain
until their passing PRs merge. Last confirmed passing runtime main: 78a3ce8.
The running browser/gateway bundle remains 992d48c; production hashes unchanged.

## Runtime PRs and decisions

| PR | Independently reviewed increment |
|---|---|
| [22](https://github.com/fishperson113/agent-expression-runtime/pull/22) | Standalone gateway, optional desktop prerequisites |
| [23](https://github.com/fishperson113/agent-expression-runtime/pull/23) | Herdr-independent terminal/stdin transport and actual delta boundaries |
| [24](https://github.com/fishperson113/agent-expression-runtime/pull/24) | Declared resting face and semantic return; canonical wire-order identity |
| [25](https://github.com/fishperson113/agent-expression-runtime/pull/25) | Bounded scene/application diagnostics and synthetic observations |
| [26](https://github.com/fishperson113/agent-expression-runtime/pull/26) | Independent cleanup and cancelled-start lifecycle |
| [27](https://github.com/fishperson113/agent-expression-runtime/pull/27) | Expired ownership release and no stale gesture replay |
| [28](https://github.com/fishperson113/agent-expression-runtime/pull/28) | Frozen holdout, shared budget and bounded model-test driver; real inference blocked |
| [29](https://github.com/fishperson113/agent-expression-runtime/pull/29) | XYZ frame signature instead of X-only proxy |
| [30](https://github.com/fishperson113/agent-expression-runtime/pull/30) | Reserved body transform applies globally once |
| [31](https://github.com/fishperson113/agent-expression-runtime/pull/31) | Explicit UI thread selection; no background-thread takeover |
| [32](https://github.com/fishperson113/agent-expression-runtime/pull/32) | Relay helper extraction to honor physical function length |

## Checkpoint 11 — final verification complete

Final stable browser/gateway soak at 992d48c completed 1,800.173 seconds after
60-second warm-up. GC-normalized private growth 8,130,560 bytes; heap growth
768,876 bytes. Sixty rolling-window samples, 14 topology/cancel/resize cycles,
18,595 typed observation frames; zero page errors, unexpected frames or observed
browser off-loopback/blocked requests. No physical camera/audio track, no inference,
no model prompts. SwiftShader FPS range 34.88–54.90; frame p95 range 31.5–44.7 ms:
stability/private-growth gates pass, sustained performance targets remain missed.

Final regression: 248 JS tests / 48 files, no skips. TypeScript/Vite build,
architecture and strict harness pass; shared gateway locked Rust test/check pass
(16 unique tests). Current-head Windows desktop/core/gateway CI passed before
runtime merges. Functional real-gateway/MCP check passes macro-after-cancel,
reload, invalid rejection, synthetic-only look/cooldown and camera-off, zero page
errors. Cold observe 46.4 ms, warm observe p95 8.83 ms, admission p95 51.9 ms;
this one functional sample overlapped a build, is not a latency benchmark, and
admission is not animation completion. Early renderer samples are not soak data.

Real Codex app-server control-plane selected two ephemeral threads in sequence
through the authenticated relay; no turn/start or inference requested. This is
protocol integration only, not successful model streaming. Model counter stays
2/120, completed holdout turns 0. Network spec revision 1 remains restricted and
enforced; chatgpt.com/storage.googleapis.com are absent, no available policy-edit
tool. The decisive ordinary-conversation semantic gate is blocked, not fixed by
fixture assertions. No additional paid plan or policy workaround was attempted.

[Sanitized evidence](evidence/cloud-live-run.json) includes complete sample vectors,
source/build hashes, before/after fixture comparison and explicit limits. Raw
traces/budget stay ignored under .runtime/live-overnight. The authoritative hard
deadline remains 22:41:03 UTC; verification finished early rather than filling
remaining time with untestable semantic guesses. Owner-PC camera, Windows GPU,
Herdr, Vietnamese /voice, distraction, >=8/10 real-person accuracy and >=6/10
human recognition are pending. See the small local checklist in fisch-live.md.

Eleven runtime branches have been removed only after main-ancestry/exact-ref
verification. Only this handoff branch remains until its green PR merges; then
verify main, remove it and leave no active owned test/browser/gateway/agent jobs.
Pre-existing branches and global provider settings remain untouched.


## Checkpoint 12 — fresh Cloud network and authentication recheck (2026-11-09)

Resumed at approximately 00:17 UTC on main `0833ae6`. New bounded deadline:
2026-11-09 06:17:35 UTC. Historical usage 2/120 was carried forward; current
usage is 4/120 including one failed holdout turn and one diagnostic inference.
The prior transient counter was not in the fresh snapshot, so its two historical
entries were reconstructed from this ledger without resetting the total.

Fresh environment configuration observations are current, spec/observed revision
1 match, and unrestricted network policy is enforced. An ordinary inherited-proxy
HTTPS request to chatgpt.com returned HTTP 200. The previous destination-policy
blocker is cleared for that host. No networking, security or credential settings
were changed. GitHub authentication and fetch worked; checkout advanced cleanly
to main. Gateway-only locked Cargo build and npm ci succeeded (npm uses the
workspace cache because the default home cache is not writable in the sandbox).

Codex login status and app-server account/read report ChatGPT login; model/list
returns a default model. These are account metadata, not inference authentication
proof. Initial holdout startup failed before any turn because sandboxed CLI could
not open its standard home SQLite state. An approved outer-executor run reached
the first frozen h01 prompt, but the model turn failed with no Fisch tool calls.
The driver stopped immediately, with zero completed holdout turns.

One bounded diagnostic inference established error code `unauthorized`: the
access token could not be refreshed because the session had logged out or signed
into another account; the service explicitly requests sign-in again. No further
model retries, credential copying, re-login or provider configuration changes were
attempted. Required next step: reauthenticate Codex ChatGPT access for the Cloud
environment through its supported login/credential setup, then launch a fresh
Cloud task and verify one counted inference before resuming the frozen holdout.
Do not paste tokens in chat. Network access alone does not restore this session.

Current holdout evidence: h01/pass 1 failed; attempted/admitted/applied/frame
counts all zero, content relevance and visual/semantic scores remain unknown.
The failed h01 screenshot is body-only, synthetic/camera-off, and stays ignored
under .runtime/live-overnight. No physical camera, microphone or owner Windows
machine was used. Previously missed render/vision targets and manual gates remain
open; no runtime change or new soak is justified by this authentication failure.

Fresh validation: 248/248 JavaScript tests across 48 files passed after installing
Playwright Chromium in a workspace-owned cache; the initial run without that
browser had eight infrastructure failures and is not claimed as passing. Locked
gateway Rust tests passed (16/16), frontend TypeScript/Vite build, architecture,
strict my-harness and whitespace checks passed. The existing large-bundle warning
remains. R10/R11 transcript verification remains unsupported in Codex.

## Checkpoint 13 — authenticated inference and thread handoff investigation

Owner completed the official device authorization; CLI reported successful login.
At 00:37 UTC the frozen 20-turn holdout resumed with the same 120-turn cap and
06:17:35 UTC deadline. All 20 model turns completed. Pass 1 admitted/applied all
ten expressions; pass 2 rejected all ten. This is a failure, not semantic success.
Two counted diagnostic turns reproduced `controller_active` on the new thread:
the previous thread's MCP controller still owns the paired renderer. Used 26/120.

Before further runtime changes, the bounded correction is: await renderer/controller
cancellation only after a successful explicit UI thread selection, before forwarding
its response; preserve failed/superseded/background selection behavior and single
controller protection. Apply the same handshake to the real model-test client.
Add stale-selection and asynchronous-order regression evidence. Also retain only
bounded fixed rejection codes and up to four body-only captures per turn 150 ms
after tool completion; final-turn screenshots can miss short gestures. No raw tool
payloads, user text or camera pixels are written by these diagnostics. Re-run the
unchanged frozen prompts after the correction, without resetting the shared count.

The two-turn diagnostic failed before the handoff correction (second thread:
`controller_active`) and passed after it (both admitted/applied with changed-frame
proxies). Fresh unchanged holdout then completed 20/20 model turns: 20 expression
attempts, 20 admitted, 20 applied, 20 frame submissions and 20 changed-frame proxies;
zero rejected calls or truncated histories. Twenty body-only active captures were
written with zero capture failures. Used 48/120; deadline unchanged. Synthetic
prompts, camera off, no owner-PC access. The first failed holdout is preserved
separately under ignored .runtime rather than relabeled as a pass.

Sample active frames were visually inspected by the agent and show facial feature
and pose changes; this is neither blinded human recognition nor proof of conceptual
relevance. The driver deliberately keeps visual effectiveness, content relevance
and semantic consistency null. The automated ordinary-conversation tool/application
path now has successful model evidence in both fresh threads. Human meaning,
perceived variety/distraction, physical-camera accuracy, Windows GPU/Herdr and
Vietnamese voice gates remain open. Earlier software-rendering/vision performance
misses remain misses; no new sustained rendering or physical-camera claim is made.

The official Face Landmarker asset now downloads through the inherited Cloud proxy
and matches pinned SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
This establishes asset availability, not camera inference throughput. No TLS,
credential, network/security policy or global provider configuration was changed
apart from the owner-authorized official Codex login.

Validation for this bounded correction: 251 JavaScript tests / 48 files pass;
TypeScript/Vite build, architecture, strict harness and whitespace pass. The seven
budget/protocol/capture tests also pass after rejecting missing diagnostic codes.
AST physical-line audit covers all nine touched JS/TS modules, maximum 35 lines per
function. Real-gateway functional acceptance was rerun alone after build completion:
cold observe 33.63 ms, warm observe p95 4.10 ms, express admission p95 16.28 ms;
macro-after-cancel, invalid rejection, synthetic look cooldown and reload passed,
zero script errors and camera off. These are functional samples, not completion
latency, a sustained performance benchmark or native GPU acceptance. No Rust code
changed; prior locked gateway build and 16 shared Rust tests remain applicable.


## Checkpoint 14 — sanitized authenticated evidence and handoff

PR #35 merged as d7bf017 after all current-head core, Windows desktop, Linux
gateway and change-budget checks passed. One additional counted real-model
preflight called observe/look and read a random synthetic image code correctly;
shape/color were also checked. The preflight's local adapter selected installed
Linux Chromium instead of the original Windows Edge fixture; the tracked
preflight script was not changed. No native hook trust was bypassed.

Total usage is 50/120 (including all historical failures and diagnostic/retest
turns); hard deadline remains 2026-11-09 06:17:35 UTC. No further model work is
needed to establish the automated application path. Full sanitized per-turn
results, before/after controller evidence, functional samples and explicit limits
are in [cloud-authenticated-model.json](evidence/cloud-authenticated-model.json).
Selected active screenshots are body-only and synthetic/camera-off; the other
transient captures, counter and traces stay ignored. No personal-machine action,
real-camera/microphone capture, credential export or policy workaround occurred.

Human recognition/relevance/consistency/distraction, physical-camera accuracy and
throughput, Windows GPU/Herdr, native hook delivery/trust and Vietnamese /voice
remain pending. Previous software-rendering and vision target misses remain.
The successful holdout establishes autonomous ordinary-conversation expression
attempts/application in this bounded synthetic run, not full PRD acceptance.

A real no-Herdr Codex TUI was additionally opened beside the paired headless body.
It stopped at the explicit “Trust this folder?” gate for this checkout. The owner
authorized official login, not additional security/trust changes, so Back/Escape
was selected and the owned CLI/browser/gateway were closed without sending a
model prompt. This startup reservation is conservatively retained as turn 50.
Successful TUI inference remains pending project trust review/authorization; it is
not inferred from the separate app-server holdout. No folder trust was granted.

## Checkpoint 15 — resumed baseline and bounded performance hypothesis

Main 4aef763 completed 1,800.228 seconds plus 60-second warm-up, 60 samples,
15 topology/cancel/resize cycles and 18,605 typed synthetic observations. Zero
page errors, unexpected frames or browser off-loopback/blocked requests. GC private
growth 8,073,216 bytes and heap growth 820,560 bytes pass the retained-memory gate.
FPS 39.55–60.01 and rolling p95 16.8–42.5 ms still miss sustained targets.

Short isolated face and bird profiles each rendered about 60 FPS at 2,000 particles;
main-thread script time was 2.37/2.81 seconds per 20-second sample. Real Face
Landmarker on Chromium's fake no-face video device measured CPU 12.85 Hz / render
35.08 FPS versus GPU SwiftShader 5.60 Hz / render 24.17 FPS. Both miss 24 Hz; these
are detector-only synthetic probes, not physical tracking/accuracy acceptance.
Both had zero audio tracks, persisted pixels, browser egress or page errors.

Before dependent changes: prefer the measured CPU path only when the GPU renderer
explicitly identifies SwiftShader, retaining GPU for native/unknown renderers and
honoring explicit CPU. Release the temporary capability-query context. Avoid
reallocating the 640x480 landmark canvas on every observation and batch its marker
submission while preserving coordinates, clearing and visibility. Add resource/
pixel regressions, compare against this baseline, then run the final stable soak.
No lower resolution/particle count, altered thresholds, model routing or security
change is part of this correction. Model count stays 50/120; deadline unchanged.

The batch-path experiment was rejected before delivery: on the same overlapping
478-landmark fixture it reduced draw submissions but worsened the short sample
from 42.44 to 23.40 FPS. Final code keeps fillRect marker semantics and removes only
repeated canvas allocation. Paired 20-second samples: 976 resizes -> 0; draw count
unchanged at 233,264; FPS 42.44 -> 50.96, rolling p95 39.8 -> 35.9 ms. This is short,
instrumented software evidence, not sustained/native acceptance.

With SwiftShader detection, the normal GPU-requested path now reports actual CPU:
12.60 Hz vs the prior 5.60 Hz GPU software sample; still below 24 Hz. Zero browser
egress/page errors/audio tracks/persisted pixels. Recovery also now consults the
worker's actual delegate instead of mistaking selected CPU for GPU; a failing
ended-track test preceded the fix and preserves explicit manual-restart preference.
255 tests / 49 files, build, architecture and strict harness pass. Browser synthetic
pixels verify markers appear and clear; AST audit maximum 24 physical function
lines across all eight touched TS modules. Final stable soak follows this change.
Isolated final gateway/browser functional check also passes macro-after-cancel,
invalid rejection, synthetic look/cooldown and reload with zero page errors and
camera off. Cold observe 45.14 ms, warm p95 4.52 ms, admission p95 24.38 ms;
these remain functional samples, not animation completion or sustained latency.


## Checkpoint 16 — final stable performance verification

PR #37 merged as f8ca747 after every current-head CI job passed and the frozen
fde1444 runtime completed 1,800.143 seconds plus 60-second warm-up. Sixty samples,
15 topology/cancel/resize cycles, 18,601 typed synthetic observations; zero page
errors, unexpected frames or browser off-loopback/blocked requests. GC-normalized
private growth 11,149,312 bytes and heap growth 1,026,328 bytes: stability/private
growth pass. No frontend changes, browser-heavy tests or model turns overlapped.

Final rolling FPS range 35.22–60.14, p95 range 16.8–42.3 ms still miss sustained
targets. Median long-run metrics are close to baseline; the short overlay sample
does not establish sustained FPS improvement. The smaller allocation workload
and correct software delegate selection are retained without claiming full
performance acceptance. Full baseline/final vectors are in
[cloud-final-performance.json](evidence/cloud-final-performance.json).

One final no-model detector probe on the committed runtime used Chromium's fake
no-face video device: GPU requested, actual CPU, 13.09 Hz (prior GPU SwiftShader
5.60 Hz); 24 Hz remains missed. Render sample 33.88 FPS, p95 46.3 ms. Zero audio
tracks, persisted pixels, page errors or browser egress; virtual capture stopped
and owned resources closed. This does not test physical camera, tracking accuracy
or native GPU performance. No additional model budget was consumed.

Model reservations remain 50/120, hard deadline 2026-11-09 06:17:35 UTC. The
completed ordinary-conversation holdout remains 20/20 admitted/applied with frame
proxies, independently of unscored semantic/human gates. Actual TUI inference is
still blocked at project trust; no trust/security change was authorized or made.
Physical-camera accuracy/throughput, native Windows GPU/Herdr, native hook trust/
context, Vietnamese /voice and human recognition/distraction remain pending.
No owner Windows machine, real camera/microphone or policy workaround was used.


## Checkpoint 17 — remaining Cloud latency samples and final counter

On main 8c0ec0a, one additional counted short synthetic conversation completed
with actual signed-in model streaming: 24 agent-message deltas / 77 code units,
replying state after 45.95 ms and a subsequent submitted frame after 65.87 ms;
output state returned to zero 127.07 ms after the last delta. These are Node-clock
upper bounds to browser state/frame proxies, not pixel-presentation or lip-sync,
and certify only this sample. No runtime change or short-reply failure was found.

A no-model local-reflex probe used typed synthetic presence and a declared body-y
pose. WebGL buffer centroid moved >2 pixels 172.7 ms after the injection confirming
arrival (one-second debounce excluded); pre-event centroid jitter was 0.184 px.
This instrumented proxy includes readback overhead and does not establish the
<150 ms first-motion target. No image buffers were persisted or exported.

[Sanitized samples](evidence/cloud-latency-probes.json) preserve both results.
Authoritative reservations are now 51/120; deadline remains 2026-11-09 06:17:35 UTC.
The earlier 50/120 artifacts now explicitly label their historical counter
checkpoint. No new code, camera/audio capture, credential/security settings or
owner-PC use occurred. Actual TUI inference remains pending explicit project
trust; no such approval has been received and the CLI was closed at that gate.
The remaining performance, physical/native and human gates stay open.


## Checkpoint 18 — restrictive TUI and corrected fake-source limit

On main b370a68, official invocation-only overrides selected untrusted project,
read-only sandbox and on-request approvals. The actual remote TUI completed one
model turn with working/replying, admitted/applied and frame-change proxies. Zero
config-write requests; home config hash unchanged; no persisted folder trust or
home hook installation. The first trailing-slash cwd mismatch stopped before
inference; normalized cwd fixed the restrictive test. Reservations now 53/120,
including that conservative startup reservation; deadline unchanged at
2026-11-09 06:17:35 UTC. No trust/security/network/credential changes were made.
[Audit and exact controls](codex-project-trust.md) explain what the dialog would
persist and why it is unnecessary for this bounded test. Default startup and
native hook delivery remain distinct owner/native checks.

New no-model profiling found default fake video capped at 20 FPS. Older detector
numbers remain observed facts but cannot certify 24 Hz with that input. A verified
30-FPS configuration delivered 27.905 Hz in an independent source-only probe;
ordinary-motion inference returned 285 samples/20 s (14.25 Hz; HUD 13.0), mean
50.28 ms/p95 77 ms inference, mean 51.64 ms post-to-result. Still below target.
The 20-FPS default-motion and motion-off diagnostic means were 45.09/26.36 ms;
transport residual ~1–2 ms. This supports investigating CPU/render contention,
not weakening workload or claiming native performance. No physical media, audio,
persisted pixels, errors or browser egress occurred; owned resources closed.
[Sanitized evidence](evidence/cloud-trust-and-timing.json) retains the distinct
windows and input limits. Human semantics, native/physical/voice, sustained render
and first-motion gates remain open. No new product code was changed.


## Checkpoint 19 — fresh-frame pacing, reflex envelope and Cloud resource limit

[PR #41](https://github.com/fishperson113/agent-expression-runtime/pull/41) keeps one
capture/inference in flight while consuming the latest delivered media timestamp
as soon as the worker returns. No repeated timestamp or backlog; stale captures
close and failed posts release their bitmap. A stale worker error cannot stop a
new session. Reflex follows its authored sinusoidal envelope without a second
100 ms value filter; ownership fade, priority, cooldown, leases and reduced/off
modes remain. No model/resolution/confidence/particle reduction.

Two alternating short pairs measured 14.15/14.05 -> 22.80/23.35 Hz and mean
result-to-next-post idle 20.68/21.62 -> 3.42/2.92 ms. Two isolated camera-on
30-minute soaks (+60 s warm-up each), baseline 8704ecc / runtime 2ec30c8, both
completed 15 topology/cancel/resize cycles and 60 samples with 640x480 nominal
30-FPS fake no-face input, CPU vision and 2,000 particles. Camera continuous,
explicitly stopped at teardown, zero audio tracks/persisted images/page errors/unexpected frames or
browser off-loopback/blocked requests. Private growth after page GC was
+19,615,744 / -14,077,952 B; both pass <100 MB (negative delta is not guaranteed
saving). Vision median 14.61 -> 22.91 Hz; render median 34.06 -> 30.87 FPS,
rolling frame p95 ranges 38.1–51.0 -> 39.3–58.3 ms. This is a disclosed resource
tradeoff; sustained 24 Hz / 50 FPS / <=20 ms remain unmet.

Fresh-page/cooldown-reset latency trials (10 per case/version) measured default
arrival median/p95 216.2/226.9 -> 160.1/168.8 ms and declared body-y 0.3 pose
179.1/209.0 -> 130.2/141.6 ms. Same >2 px centroid criterion, 24 Hz synthetic
observations, debounce excluded/readback included; all 40 noise floors valid.
Only the declared fixture meets <150 ms in this sample; default remains open.
The new reproducible camera-off script preserves session-change quarantine by
creating a fresh client per reload; the initial stale-client request was rejected,
not replayed. No product safety behavior was relaxed.

A separate dev-module CPU diagnostic measured GPU process 72.08 CPU-seconds in
20.13 seconds, cgroup 80.46 CPU-seconds, quota four cores, 202/202 periods throttled,
no exposed /dev/dri; main thread sampled idle 16.85 s. CPU-copy input alternatives
regressed to 14.10 / 14.90 Hz versus retained Bitmap 23.05 Hz and were not shipped.
No further safe speedup was demonstrated without changing quality, authored
motion semantics, the SDK/graphics pipeline or platform resources. Detailed
[measurements and method](validation.md#vision-pacing-and-reflex-envelope--2026-11-09)
and [numeric vectors](evidence/cloud-pacing-performance.json) preserve tradeoffs.

Model reservations remain 53/120; deadline remains 2026-11-09 06:17:35 UTC. All
new probes used zero model calls, no real camera/mic, owner Windows machine,
credential/security/trust changes or private payload export. The already-passed
20-turn admission holdout was not rerun for unchanged admission/model behavior.
Physical accuracy/throughput, native GPU/Herdr/hooks/voice and human semantics
remain pending. R9 reports the large numeric evidence addition; data was not
compressed/deleted to evade that informational warning. Hard harness rules remain
required, with R10/R11 unknown in Codex.


## Checkpoint 20 — two bounded contention rounds, no new runtime change

On runtime 318af9c, tested two isolated hypotheses in alternating baseline/candidate
pairs (two repeats each, 10 s warm-up + 20 s/window): skip clears of an already
blank overlay; remove unused depth attachment/test from the single Points layer.
Neither had consistent gains. Overlay inference deltas -3.01/+0.67%, render
-1.35/+1.69%; no-depth inference -4.59/-0.19%, render -2.16/+0.69%. Overlay clear
calls really fell 469/443 -> 0. Twelve nonblank depth/overlap/size/brightness/scale
framebuffer fixtures had zero RGBA differences, but that did not establish a
speedup. Both candidates remain unshipped; no third optimization round attempted.

All eight windows kept the same fake 640x480 nominal 30-FPS no-face source, CPU
vision/SwiftShader, bird geometry, 2,000 drawn/simulated particles and normal motion.
No model/confidence/quality/cadence/acceptance reduction. Zero page errors,
unexpected frames or browser external/blocked requests; camera active throughout.
[Results, exact patches and limits](evidence/cloud-contention-followup.json) are
preserved without selecting only favorable windows.

Additional first-response diagnostic with real inference on the fake source used
the supported turn cue and declared body-y 0.3 / 600 ms turn_changed reflex:
10 trials, median 142.9 ms, sampled p95 218.2 ms to >2 px buffer-centroid change,
max noise 0.8765 px. Includes readback and local working/attention; a different
case from camera-off arrival, not a causal before/after comparison. No presence
injection or synthetic-camera guard bypass. Camera explicitly stopped, zero audio,
model calls, persisted pixels, errors or browser egress. Default/native first-motion
and sustained performance gates remain open.

Stopped the optimization search after the two non-improving rounds as requested.
Runtime remains unchanged; no device-personal access, network/security/trust or
credential changes. Model reservations remain 53/120; deadline unchanged at
2026-11-09 06:17:35 UTC. Remaining physical/native/human/voice gates require
appropriate real evidence and were not certified by these Cloud tests.

## Phase 2026-11-09 — blind video delivery and compact UI

Fresh Cloud executor, main 88012b0; branch codex/blind-video-minimal-ui. Prior
executor's transient ledger/captures are unavailable here. Conservatively carry
53/120 reservations forward (checkpoint 20), with no reconstruction of missing
turn records. New phase hard deadline: 2026-11-09 13:45:00 UTC. Never reset the
120-turn lifetime cap. Stop Cloud performance optimization as assigned.

Record actual canvas video during fresh frozen holdout turns; never animate old
screenshots into purported model evidence. Random blind codes and scoring CSV
exclude prompt/ordinal; answer key and raw recordings stay in a separate private
directory. Human recognition/emotion/theme acceptance remains pending owner
scoring tonight; do not revise expressions before that test.

Reference sword_formation was inspected as a layout reference only: large scene,
small optional camera/control surface. GitHub root has no license; no source or
assets copied. Maintain keyboard controls, reduced motion and camera-off default.

Delivery checkpoint: Cloud app-server initially could not open its SQLite runtime
inside the read-only home sandbox. Approved outer execution enabled only the
normal runtime writes. A counted attempt then failed, and one counted diagnostic
returned `unauthorized`: refresh token invalidated by logout/account change,
with zero MCP calls. `codex login status` alone incorrectly appeared signed in.
Do not retry inference until the owner reconnects Codex in this Cloud environment.
Current lifetime reservations: **55/120**, including both failures; 0 new valid
holdout clips. The prior 20 screenshot samples cannot reconstruct model motion.
No credentials, trust settings or home hook configuration were changed.

Recorder apparatus check (deterministic fixture, not model holdout): actual
WebGL canvas stream produced a 2.753-second H.264 clip, 64 decoded frames/64 unique
frame hashes, 606x454 padded from odd 605x453, one video stream and no audio.
Camera inactive, zero browser script errors. Frame uniqueness is an encoding/
motion sanity check, not semantic recognition. Compact layout passed desktop,
375px overflow, camera disclosure and reduced-motion/keyboard regressions.
263 JS tests pass, architecture and production build pass. Chunk-size warning
remains. Strict my-harness passes; R10/R11 are unknown in Codex.

Human kit flow after reconnect: run the guarded holdout once; share only `blind/`
(20 MP4s, local gallery, scoring CSV), never the parent run directory or private
answer key. Clips retain the actual performance from one second before the first
expression tool receipt until at least 10.5 seconds after turn completion; a turn
without an expression remains visible as a no-expression result. Failed turns
stay private and stop the run. Owner scores theme/emotion and clarity independently
before comparing the separate prompt key; the >=6/10 gate stays pending. ffmpeg
is required and checked before any inference reservation.
