# Fisch Live POC — implementation and acceptance plan

Status: implementation active; C00 pushed before runtime changes.
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
