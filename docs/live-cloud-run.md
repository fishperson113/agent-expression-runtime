# Fisch Live cloud execution — 2026-11-08

T0: 2026-11-08 16:41:03 UTC. Hard deadline: 22:41:03 UTC.
Real Fisch model test budget: 120 turns including retries/evaluation; used: 0.
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
