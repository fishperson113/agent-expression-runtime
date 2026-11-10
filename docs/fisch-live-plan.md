# Fisch Live POC — historical implementation and acceptance plan

**Historical scope:** This is the original 2026-11-08 plan and its recorded acceptance. Later changes made normal-terminal `fisch live` the default and removed `fisch run`; the original preserve-panel decision below is superseded. Use [the current Live guide](fisch-live.md) and [CLI migration](multiplexer.md), not these historical branch/launch instructions.

Status at that checkpoint: bounded POC implementation and automated acceptance complete; manual/PRD gaps remain explicit below. C00 was pushed before runtime changes.
Date: 2026-11-08 (Asia/Saigon). Baseline: `bbb2ede`, runtime `9863ba3`.
Source: user-supplied PRD “Fisch Live POC: gương mặt có thị giác cho agent”, 2026-11-08.

## Confirmed decisions

- Build for local Windows + Codex CLI in Herdr, with a separate local browser showing camera debug and the WebGL particle body. Preserve `fisch run`; add `fisch live`.
- Work on `codex/fisch-live`. Commit and push this plan before runtime changes, then commit/push validated increments on this branch. Do not merge main or force-push.
- Real camera may be opened for local processing only. Do not save camera frames, screenshots containing the camera, recordings, or send real camera images to Codex/providers. `look` testing uses clearly identified synthetic images only. Live mode initially enforces synthetic-only image delivery; enabling real image delivery requires a later explicit user decision.
- Signed-in Codex tests with synthetic prompts/world states are authorized and may consume provider quota. No background microphone recording. Voice is tested manually with the user when available.
- Typed input is an accepted fallback. Unverified/unreliable voice or Herdr output rhythm must be reported honestly, not silently marked passed.
- No fixed prompt-to-shape routing or anatomy inferred from names. Agent chooses geometry/parts; defaults are declarative bounded data. Camera observations are estimates, not identity/emotion/attention facts.

## Preflight recorded before implementation

- Git clean at `bbb2ede`; origin is `fishperson113/agent-expression-runtime`. Remote HEAD was `9863ba3`; push dry-run succeeded. Pushing this branch includes the preceding documentation reconciliation commit.
- Node 24.15.0; Cargo 1.97.1; Codex CLI 0.167.0. Herdr 0.7.5-preview, protocol 17, running in Windows Terminal. Codex is present in pane `w4:pJ`; neighboring shell `w4:pK`. Pane IDs are observations, never hard-coded runtime defaults.
- Herdr pane read works. Its `agent start` Windows launcher failed for empty arguments / PowerShell shim; direct `codex --no-alt-screen` in the pane worked. Use the working path rather than changing global settings.
- Native Edge 157 opens through Playwright; WebGL2 uses AMD RX Vega 10 through ANGLE/D3D11. Worker, OffscreenCanvas and video-frame callback are available. This is capability evidence, not sustained FPS acceptance.
- Browser enumerated one camera and one microphone. Authorized local camera probe acquired 640x480 video, nominal 30 FPS; observed 45 callbacks over 2.53 seconds. No audio track, recording, image upload or persisted image. Camera was stopped after the probe. Nominal device FPS is not measured inference FPS.
- Existing Codex Fisch hooks are installed; actual trust/delivery remains to be verified. A changed hook definition must be reviewed by the user in `/hooks`; never bypass trust.
- Baseline checks passed: 195 JS tests / 31 files, 12 Rust tests, frontend build, architecture boundary. Existing >500 kB bundle warning remains.

## Scope and acceptance corrections

World state is a versioned observation snapshot. Add session/sequence, captured/received timestamps, freshness and camera status (starting/tracking/absent/denied/error/stale). Unknown pose/expression is null, not a fabricated neutral measurement. Head-facing is a head-pose proxy, not eye tracking. Near/far is a relative estimate; omit if not calibrated. A quality score must document its derivation and must not pretend to be a calibrated model confidence.

Keep fast continuous tracking separate from debounced semantic events (arrival >=1 s, facing change >=700 ms). Measure confirmed-event-to-first-motion latency separately from debounce; do not claim appearance-to-motion <150 ms while waiting a second to confirm arrival. Local reflexes remain in the browser and do not round-trip through the 10 Hz gateway.

Lifecycle and output activity are separate signals. UserPromptSubmit means prompt submitted, not microphone listening. Tool hooks do not establish replying. Pane output is an explicitly approximate signal; tool/spinner/redraw noise must be tested. No output signal is better than fabricated speech/progress.

Admission statuses stay received/pending/accepted/applied/rejected. A fast receipt is not compiler acceptance. Measure warm observe p95 <=30 ms, express admission p95 <=50 ms as targets; retain pending semantics where needed. Record renderer-start latency separately. No promise that a sequential MCP tool call streams concurrently with model text.

Privacy wording: typed observations may be supplied to Codex; real pixels stay local in this authorized run. Synthetic look images may leave the machine. A visible indicator and reason appear before image delivery. A file fallback, if unavoidable, contains synthetic images only and has TTL + crash cleanup. No keys in logs, URLs, docs or evidence.

## Architecture

1. Browser: camera/video preview, MediaPipe Worker, observation aggregator, local signal bus, data reflex director, motion compositor, existing compiler/scheduler/ThreeRenderer and camera-free diagnostics.
2. Gateway: reuse the existing Rust `--browser-gateway` mode, loopback authorization/origin/host policy, renderer ownership and admission path. Add bounded observation transport and synthetic look request/response. No Tauri packaging or separate chat UI.
3. MCP: extend existing server with observe/look and Live capability discovery. Avoid serializing snapshot reads behind mutation/look calls. Bind each Live run to one renderer, one selected Codex session/pane and one observation stream.
4. Codex: native prompt hook supplies bounded current observation context, fail-open with a short deadline. Agent uses express to choose body/illustration/bindings. Disable secondary planner and old idle-scene director in Live; retain them in existing pane mode.
5. Herdr: discover selected pane, subscribe to lifecycle and read bounded snapshots for optional output activity; never forward raw terminal text to the browser/model as observation context.

Core remains independent of DOM, Worker, Tauri, provider code and Three.js. Vision assets/package versions are pinned and served locally after installation; camera frames never go to a CDN. GPU Worker inference is capability-tested; CPU fallback is explicit and measured.

## Live contracts and budgets

- Preserve legacy v1 commands. Define an explicit Live extension schema (configuration/program fields) and advertise support; no arbitrary JSON accepted by the renderer. Stage all fields before atomic installation, including the ordinary AST program. Keep macro transaction semantics.
- Canonical channels are `(partId or body, property)`. Layers: ambient < reflex < binding < explicit semantic gesture. Same-layer overlapping writes reject. Upper layers suppress only owned channels and blend on release.
- First slice supports replace composition. Additive transforms are deferred until their order and combined bounds can be specified and tested; report this PRD deviation.
- Bindings declare signal, part/channel, gain, offset, clamp, smoothing and lifetime. Orient supports user target and bounded yaw/pitch. Use radians internally and document degree conversion at the world boundary. Default absolute scale has a neutral value of 1.
- Missing/stale signals return smoothly to neutral; topology change invalidates missing-part bindings. Cancel/interrupt clears semantic action and old continuation; session reset clears configuration and event state. Motion-off suppresses all dynamic layers; reduced-motion attenuates them.
- Bound initial configuration to 16 bindings, 16 reflexes, at most one reflex action per tick, no recursively triggered rules, 24 assembly parts and existing compiler/program budgets. Enforce cooldown with monotonic time and bound event memory to 64 records. Tune only with documented evidence.
- Observation snapshots use latest-value replacement, never an unbounded queue. Events carry monotonically increasing IDs and a per-consumer cursor with gap detection. Hook snapshots must not consume the model's observe cursor. Browser reconnect must not replay obsolete gestures.
- `look`: reason required, one pending request, <=768 px longest side, JPEG byte limit, one request per 5 seconds enforced at authority, 2-second request deadline, synthetic-only mode explicitly visible. No real camera image upload code path enabled by default.

## Commit sequence

Every row is one reviewable commit target, not permission to leave broken intermediate interfaces. Split further if a hard harness limit would be exceeded; update this plan in the same bounded batch. Exact filenames may be refined after spikes, with the change recorded here before dependent work.

| ID / commit subject | Intended files / upper budget | Work and completion gate |
| --- | --- | --- |
| C00 `docs: record Fisch Live implementation plan` | This document (1) | Record scope, preflight, privacy, commits and acceptance; push before C01. |
| C01 `test: add Live integration preflight probes` | `scripts/live-preflight.mjs`, probe helpers under `integrations/`, `tests/live-preflight.test.mjs`, this plan (<=6) | Reproducible synthetic-only hook context/MCP image/Herdr probes; verify CLI auth and actual model vision, distinguish mocked and native evidence; bound duration/process cleanup. No global config/trust edits. |
| C02 `feat: define typed Live observations and signals` | `src/core/live/types.ts`, observation/signal validators, `src/contracts/live.schema.json`, `src/contracts/capabilities.json`, `tests/live-contracts.test.ts`, plan (<=8) | Versioned snapshots, null/quality/freshness, cursor/gap semantics, signal registry/ranges and strict bounded validation. No camera/model calls in unit tests. |
| C03 `feat: add local face observation pipeline` | package + lockfile, `src/live/vision.ts`, `src/live/vision.worker.ts`, aggregator, asset preparation script, observation tests, plan (<=9) | Pinned MediaPipe, local assets, latest-frame Worker mailbox, smoothing/hysteresis/debounce and Vietnamese summaries; handle denied/stopped camera. Measure real local camera without retaining pixels. |
| C04 `feat: compile bounded Live control data` | Live compiler/validation modules, legacy compiler integration only if needed, AST/IR/schema generation sources and contracts/tests (<=10) | Atomic Live configuration admission; bind/orient/reflex data syntax, property conflict validation, references, budgets and compatibility. All touched functions <=50 lines; extract helpers instead of exceptions. |
| C05 `feat: compose Live reflexes and signal bindings` | Live compositor/director/signal modules, geometry integration, scheduler adapter, default reflex JSON, runtime tests, plan (<=9) | Channel ownership, local orientation, smoothing, cooldown, stale neutral, topology/cancel/reset, off/reduced. Deterministic clock tests; no per-frame model/AST submissions. |
| C06 `feat: add local Fisch Live browser workspace` | `live.html`, Live entry/body/camera/view modules, Live CSS, Vite build config if needed, browser test, plan (<=10) | Two adjacent camera/body regions, existing geometry/WebGL, explicit start/stop, diagnostics, synthetic-only look indicator; keyboard labels/focus and motion controls. Preserve existing page and pane workflow. |
| C07 `feat: bridge Live observation and look requests` | Cargo manifest/lock if needed, new Rust Live module, gateway/main integration, TS browser transport, transport tests, plan (<=9) | Authenticated bounded WS observations/request-replies with origin policy, rate/byte limits, TTL and connection replacement. Preserve existing gateway receipts/ownership. Synthetic-only look, disconnect cancels pending. |
| C08 `feat: expose Live observation tools to Codex` | MCP server + extracted Live tool module, Live instruction Markdown under integrations, prompt hook module, install/config helper, MCP/hook tests, plan (<=8) | Observe snapshot/events, image look, schema discovery, fast reads, prompt context injection fail-open, explicit session matching. Existing legacy tools unchanged. Document trust handoff if required. |
| C09 `feat: launch Live beside an existing Codex pane` | `bin/fisch.mjs`, `scripts/live-session.mjs`, Herdr output sampler/lifecycle adapter, CLI/default instruction integration, launcher/output tests, plan (<=9) | `fisch live --agent ...`, pair browser without tokens in URL, optional rhythm with <=600 ms decay and noise tests; stop only owned processes/resources. Never launch a competing planner. |
| C10 `test: verify Fisch Live end to end` | Native smoke/acceptance scripts, deterministic fake-camera fixtures, browser/MCP integration tests, camera-free evidence JSON under docs/evidence, plan (<=8) | Actual Codex observe/express/image fixtures, wrong session, stale data, disconnect, renderer recovery, no camera frame egress, accessibility keyboard/reduced/off. Record latency and inference counts. |
| C11 `docs: publish Live usage and acceptance results` | README, Live guide, architecture/integration/validation docs, plan and sanitized evidence (<=9) | Exact launch/test/stop steps, supported/unsupported PRD matrix, measured hardware/results, privacy and remaining manual voice/perception work. Push final validated branch; no merge. |

## Harness and Git rules for every batch

- At most 10 changed/new/deleted files before each commit; count the plan/evidence too. Do not start the next batch until the current one is committed. Existing user changes, if any appear, are not staged or overwritten.
- No copy-style filenames, backups or `_v2` variants. New Markdown only inside `docs/` or `integrations/`. Do not create a root AGENTS.md; use the allowed integration instruction bundle and scoped hook context.
- Every function touched, including tests/closures, stays within 50 physical lines. Added comment lines stay below 30% of added lines per file. Prefer small modules over `hack:` exemptions; none are planned.
- Inspect `git diff --check`, diff file count and function lengths before each commit. Run focused meaningful tests for the batch; run build/boundary checks when runtime/schema/render changes. Run the full JS and Rust suites at integration milestones and final acceptance.
- Record unexpected failures and their remediation. A passing isolated rerun is not described as a clean full-suite pass. Do not bypass auto-review, hook trust or OS privacy settings. R10/R11 are unknown and transcript verification is unsupported; do not claim they were checked.
- Push normally to the feature branch after passing gates. No force push, main merge, external messaging or unrelated setup. Keep transient logs/assets/screenshots in ignored `.runtime/`; only sanitized summaries go into Git.

## Final acceptance matrix

| Area | Required evidence |
| --- | --- |
| Local observation | Native camera starts/stops; metrics distinguish camera FPS, inference FPS and render FPS; absent/denied/stale handled; no audio capture. |
| Reflex | Event debounce separate from confirmed-event-to-render p95; local behavior without any model request. No anatomy name guessing. |
| Codex context | Native hook injection verified or documented observe-first fallback; fresh timestamp and unknown handling; no unsolicited surveillance narration. |
| Express/DSL | Agent-authored unseen geometry through compiler; ownership, atomic rejection, cancellation, reset and part identity work. Human theme recognition needs user observation and is not fabricated by automated tests. |
| Look | Real Codex correctly interprets a synthetic-only visual fixture; indicator/reason, 5-second limit, bytes/deadline and cleanup pass. Real-camera model vision is intentionally untested/disabled. |
| Output rhythm | Test Herdr redraw/spinner/tool output negatives and text positives; expose proxy quality. If native reliability fails, label experimental/off and deliver typed core. |
| Browser accessibility | Keyboard-operable camera/motion/stop controls, visible focus, labels, non-color-only status, readable layouts, reduced motion and complete motion-off. Debug JSON is not announced at 10 Hz to screen readers. |
| Reliability | 30-minute native session/soak after warm-up, bounded memory/queues; camera disconnect, browser reload, gateway loss and interrupt. Report process-specific memory; target <100 MB retained growth is measured, not assumed. |
| Performance | Report p50/p95 and device/resolution/particle count. Targets: >=24 inference FPS, >=50 render FPS, confirmed-reflex <150 ms, output <250 ms, decay <=600 ms, warm observe <=30 ms, express admission <=50 ms / first motion <=100 ms. Misses are explicit with tuning/fallback. |
| Voice | User-spoken Vietnamese /voice is manual and optional under the confirmed fallback; do not infer it works from microphone enumeration. |

## Progress ledger

- Preflight: toolchain, Git transport, Herdr pane access, native GPU/browser, authorized local camera acquisition and baseline suites passed as recorded above.
- Awaiting after C00: actual hook context and synthetic MCP vision; full MediaPipe Worker GPU compatibility; accurate Herdr text rhythm; native soak and human expression perception.
- No implementation changes or camera imagery are included in C00.

### C01 completed

Native Codex 0.167.0 called both probe tools and correctly read a red circle and random four-digit code from synthetic MCP image pixels. The first attempt hit tool approval because the probe lacked an explicit automatic read-only policy; adding read-only annotations and a per-probe auto policy made the authorized test pass. No hook trust was bypassed. Native prompt-context injection remains unverified; observe-first fallback is the initial supported path. Two probe contract tests and staged structural checks passed. Added `scripts/check-live-harness.mjs` for staged file/function/comment checks; Rust function lengths still require manual review. Probe output is ignored under `.runtime/live-preflight/`.

### C02 completed

Added strict observation v1 types/schema, named bounded signals and a pure latest-snapshot/event store. Store rejects wrong sessions, old sequence/timestamps and malformed events; independent cursors report history gaps without consuming hook/model reads. Stale snapshots replace pose/expression with unknown. Focused contract/regression tests: 17 passed; frontend build and core boundary passed. Runtime/gateway wiring follows in later commits.

### C03 completed

Pinned tasks-vision 1.2.2; local WASM/model assets are prepared under ignored public/live-assets, with model SHA-256 verification. Module-worker loader is fetched locally into a temporary blob to avoid Vite importing public scripts. Native authorized camera probe returned 478 landmarks with GPU delegate (51 samples, approximately 10 Hz; mean measured inference 165 ms in this short run). The >=24 FPS vision target is not met on this probe; keep latest-frame/drop-backlog policy and report/tune at integration. No camera pixels were saved or uploaded. Five observation/contract tests and TypeScript/build/boundary checks passed. Worker stop closes stream/bitmaps and denied/stopped status invalidates observations.

### C04 completed and bounded syntax refinement

Live commands use `{type: live, program: <legacy AST or null>, configuration: {controls, poses, lifetimeMs}}` inside the existing program envelope. A LiveCompiler wrapper stages configuration validation before the shared legacy compiler, preserving legacy behavior and total record bytes. Controls support bind, orient and event reflexes; this first bounded reflex action is a typed transform `pose`, not arbitrary nested geometry/macros. This explicit PRD deviation avoids recursive/competing shape schedulers and is advertised in capabilities; full geometry remains available to the agent through program/assemble. Replace-only composition remains as planned. Focused contract/compiler tests: eight passed; build and boundary checks passed.

### C05 completed

Added bounded channel compositor (reflex < binding < explicit pose), local user orientation, signal smoothing/neutral fallback, lease expiration, cooldown and topology invalidation. Default reflexes are JSON data. Shared geometry exposes part metadata and ownership; transform matrices use declared part centers and a reusable per-point scratch buffer. Deterministic compositor/geometry plus existing sculpture/shape tests: 15 passed; TypeScript and architecture checks passed. Browser integration and native visual checks follow in C06.

### C06 completed

Added separate live.html with camera/debug and WebGL body, explicit camera start/stop (no audio), reduced/off motion, stop-all, keyboard skip/focus, labels and responsive 375px layout. Reused shared compiler/scheduler/ThreeRenderer at 2,000 drawn particles; no secondary planner. Native Edge page had no script errors and no camera track until explicitly started; camera-off screenshot visually inspected locally. Browser keyboard/reduced-motion/stop/mobile test passed. Build and boundary passed. Early 0.5-second startup FPS is not steady-state performance acceptance. Initial browser test required the installed Edge channel because bundled Chromium is absent; test now uses Edge on Windows. UI search matched operations/status guidance; no marketing layout or external font/CDN added.

### C07 completed

Extended the existing loopback gateway with an origin/host-checked WebSocket, first-message token authentication (no token URL), single connection, bounded snapshots/events and synthetic-only look request/reply. Observe checks controller ownership; context reads are non-consuming. Rust recomputes summary text rather than trusting arbitrary browser text. Look has image/dimension/byte validation, one pending request, five-second authority cooldown and two-second timeout. Native browser/gateway smoke passed: snapshot available, expression accepted, synthetic JPEG 200, immediate second look 429, unauthenticated read 401, camera inactive. Fifteen Rust tests and build/boundary checks passed. UI test timed out while overlapping another graphical smoke, then passed alone (one test); run graphical acceptance sequentially. All added Rust functions manually checked under 50 lines.

### C08 completed

MCP Live mode adds observe/look and a namespaced extension schema/resource without altering legacy mode. Observe reads bypass the mutation queue, preserve independent cursors and clear failed session state. Look returns synthetic image content only. Vietnamese instructions explain privacy, proxy signals, DSL budgets, no anatomy inference and observe-first/no unsolicited camera narration. Added a bounded 180 ms fail-open prompt-context hook module; it is not globally installed or automatically trusted. Native hook injection remains unverified, so observe-first is the supported fallback. Thirteen MCP/hook/preflight tests passed, including legacy lifecycle regressions; staged structural checks passed.

### C09 completed and launcher refinement

Native launcher opened a separate Fisch Live Herdr tab (observed pane w4:pM) with transient MCP environment; the old pane w4:pJ was unchanged. A running CLI cannot be assumed to accept new MCP configuration, so --agent selects source workspace while Live starts a dedicated interactive Codex session, not a secondary expression planner. Credentials stay in inherited environment, never command arguments/files. Existing toolchain native gateway binary must be built beforehand. Native interactive test called observe, accepted express and returned the synthetic red-circle image with a four-digit answer. Codex correctly described stale data as unknown. The first express required a normal MCP confirmation, accepted for this authorized test; added truthful non-destructive/local tool annotations rather than bypass approval. Herdr agent.prompt left text in the composer; explicit Enter submitted it. Output rhythm remains experimental and OFF by default (`FISCH_LIVE_RHYTHM=proxy` opts in); no accurate speech/stream sync is claimed. Twenty-eight launcher/CLI/hook regressions, build/boundary and structural checks passed.

### C09a — lifecycle hardening (bounded extra commit)

Integration inspection found two lifecycle hazards: epoch cancellation should preserve committed macros, and a turn change must not freshen old camera measurements. Fixed both before soak. Added Live private IPC delivery for already-installed/trusted native hooks, forwarding only event type (never prompt text) to the browser. Herdr activity now drives presence activity; a data-defined turn cue supplements local camera reflexes. Native hook delivery still requires real trust verification; context injection remains the observe-first fallback. Eleven targeted tests, build/boundary and structural checks passed. This additional nine-file batch keeps the original C10 acceptance batch within the harness limit.

### C10a — acceptance preparation (bounded extra commit)

Added browser re-pair after reload without replaying uncertain gestures, preserved the stopped UI state, and fixed explicit stale-camera propagation in both stores. Live now simulates the same 2,000 particles it draws instead of paying for the default 10,000 formation; legacy schedulers retain their default. Camera-free aggregate metrics are exposed for native acceptance. Ten focused JS tests, 16 Rust tests, build and boundary checks passed. This ten-file batch precedes acceptance tooling/soak so the harness remains bounded.

### C10b — reproducible acceptance tooling

Added MCP integration client, native-gateway acceptance script and bounded 30-minute soak runner with local-only camera opt-in, frame-egress counters, GC-normalized heap/private-process memory and repeated topology/cancel/resize cycles. Full JS suite passed cleanly: 218 tests / 39 files with one worker; 16 Rust tests passed in C10a. Corrected cold/warm and admission timing measurement: functional headless run recorded cold observe 78.7 ms, warm observe p95 5.3 ms and express p95 27.2 ms. Macro-after-cancel, reload, synthetic image/cooldown and zero script errors passed. Sanitized evidence is docs/evidence/live-acceptance.json. These software-rendered timings do not certify native GPU performance. Real-camera 30-minute soak starts next; no real camera image export or model prompts are permitted in it.

### C11a — usage documentation checkpoint

Added Live usage/privacy/DSL/hook-fallback guidance, linked it from README/architecture/integration/browser docs and refreshed dependency metadata (including tasks-vision and WebSocket crates). Relative links pass. Native soak is not accepted: the first dev-server run reached a stopped camera state and was interrupted; a static-build camera retry failed initialization. Aggregate camera transition diagnostics and production-server isolation are being added before retry. Documentation explicitly keeps soak/human/voice acceptance pending. This documentation checkpoint also frees the ten-file harness budget for the runtime remediation.

### C10c — native camera remediation

The raw HD User Facing camera stayed live for 15 seconds without track events, while combined GPU vision/WebGL probes ended the video track after a few seconds. A CPU vision probe stayed active/tracking for 18 seconds (about 8.3 samples/s, renderer about 60 FPS). This isolates the failure to the combined GPU path on this machine, not a proven universal driver diagnosis. Added one bounded GPU-ended-track -> CPU recovery, preserving manual stop (tested), and an explicit FISCH_VISION_DELEGATE=CPU override. Added camera transition/track diagnostics and made soak fail if camera stops. Live now builds/serves static assets by default to avoid HMR camera resets during coding; Vite paths are checkout-relative and the new Codex pane preserves the source project cwd. Six focused vision/launcher tests, build/boundary passed. Soak restarts after this checkpoint; no failed/interrupted attempt counts as 30-minute acceptance.

### C10d — browser egress isolation

The restarted native GPU run stayed tracking for several minutes at approximately 60 render FPS, but egress monitoring counted external requests. Inspection of the pinned SDK identified its odml.pa.googleapis.com logging endpoint; no evidence of camera image payloads was collected or exported. Interrupted that run rather than treating it as privacy acceptance. Added loopback-only CSP response headers to both documents and worker scripts in dev/preview, blocking vendor logging and other off-machine fetches; a browser test verifies main-thread and worker off-machine fetch are blocked. Egress counters distinguish explicit CSP-blocked attempts from unblocked requests. Privacy test and frontend build passed. The 30-minute acceptance run restarts on this policy-enforced build.

### C11b — final acceptance and handoff

Final policy-enforced native camera soak completed 1,801 seconds after 60 seconds warm-up: camera stayed active on GPU, 15 topology/cancel/resize cycles, 17,396 typed observations, zero unexpected frames, image deliveries, off-loopback requests or script errors. GC-normalized browser private growth was 37,306,368 bytes (<100 MB); JS heap growth 87,100 bytes. Sample mean FPS was 58.0–60.0 and rolling frame p95 17.1–29.4 ms: sustained <=20 ms is not certified. Vision stayed about 9–10 Hz, below the 24 Hz target. Camera/audio metadata: 640x480, zero audio tracks. Camera stopped during teardown. Sanitized aggregate evidence is [live-soak.json](evidence/live-soak.json); no real camera imagery was persisted or supplied to a model. The soak driver made no model prompts; a separate explicit synthetic sailboat Codex probe ran during the interval and produced an accepted six-part assembly (human recognition not assessed).

Final regression on runtime commit 8dc646a: 221 JS tests / 41 files, 16 Rust tests, production build and architecture boundary passed. Final static-browser/gateway/MCP acceptance passed: warm observe p95 5.2 ms, express admission p95 29.0 ms, cold observe 78.8 ms, macro-after-cancel, reload, synthetic-only look and zero script errors. Headless software-rendered timings are functional evidence, not native GPU certification. Existing >500 kB Three.js bundle warning remains. Updated usage, architecture, validation and sanitized evidence in this bounded documentation batch.

Delivered scope is camera-local observation + WebGL body + dedicated Codex/Herdr MCP session with observe-first, typed fallback and optional experimental output proxy. Remaining PRD/manual gates: observation accuracy >=8/10, human theme recognition >=6/10, distraction evaluation, native prompt-hook trust/context delivery and Vietnamese /voice. Deferred features: additive composition, condition-based/arbitrary-program reflexes and real-camera look. These are disclosed limits, not acceptance passes. No merge into main or global hook/config changes.

### Follow-up — one-command launch

User requested a parameter-free command. `fisch live` now selects the calling Herdr shell workspace (focused pane fallback), starts its own Codex and needs no existing Codex agent or pane ID. Explicit --agent remains a debug override. Installed command is already on PATH on this machine; fresh checkouts use npm link once. Tests cover no-agent startup source, multiple unrelated agents, focus fallback and explicit override. This changes source selection only; privacy, pairing and previous-session preservation remain unchanged.
