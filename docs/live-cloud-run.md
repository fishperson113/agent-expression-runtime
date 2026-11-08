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
