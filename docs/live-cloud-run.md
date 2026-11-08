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
