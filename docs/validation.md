# Validation scope and evidence

The current implementation includes pane attachment, native interaction hooks, contextual planning, continuous presence, model-authored performances, adaptive Braille and prepared idle scenes. See [current behavior](expression-planner.md), [review remediation](review-progress.md) and [research/evidence limits](related-work.md#10-cập-nhật-braille-theo-thời-gian-và-idle-scene-tự-do). Test counts below are historical observations, not the current suite size or a fresh certification.

## Cloud terminal/face development — 2026-11-08

This run used managed Linux Cloud while the owner's computer was off. The stable browser/gateway source
is 992d48c (merged into main as 74195ca); the final Node-only thread-selection
correction is c0d63ce, followed by relay helper extraction 6ac50b7 (runtime
main merge 9e79030). The execution deadline and model
counter are preserved in [the Cloud ledger](live-cloud-run.md). The historical
native results below remain separate.

| Gate | New Cloud evidence | Status/limit |
|---|---|---|
| No Herdr required | Real Codex CLI UI and paired browser launched with HERDR_* absent; discovery and owned cleanup regressions | Launch verified; successful real model turn blocked |
| Resting face/lifecycle | Declared geometry, explicit role metadata, inspected body-only screenshots; working/replying and motion-off tests | Agent visual proxy; human perception pending |
| Illustrate/return/cancel | MCP/gateway/compiler/WebGL fixtures; restored facial geometry after wire reordering; stale gestures not replayed | Deterministic fixtures, not autonomous semantic choices |
| Output rhythm | Official agent-message delta boundaries, stale/thread/tool noise tests, <=600 ms decay | Real output streaming still needs model-connected validation |
| Synthetic observations | Present/absent/stale/denied/error, typed aggregator/bridge; no physical devices opened | Not Face Landmarker throughput or actual-person accuracy |
| Regression | 248 JS tests / 48 files, no skips; build/architecture/harness and 16 shared Rust tests/check pass | Final count/results in dated evidence and ledger |
| Warm/cold RPC | Cold observe 46.4 ms; warm observe p95 8.83 ms; expression admission p95 51.9 ms | Single headless functional sample during build load; not a latency benchmark or animation completion |
| Stability/privacy | 1,800.173 s + 60 s warm-up; GC private growth 8,130,560 bytes; zero page errors/unexpected frames/off-loopback browser requests | Stability/private-growth passed; sample FPS 34.88–54.90 and frame p95 31.5–44.7 ms miss sustained targets; no native certification |
| Ordinary unseen model behavior | Ten frozen prompts, two passes and strict shared budget driver prepared | BLOCKED: Cloud policy denies chatgpt.com; 0 completed holdout turns |
| Physical-camera inference | Model asset download denied at storage.googleapis.com | BLOCKED in Cloud; >=24 Hz remains unverified |
| Native/manual | No new owner-PC camera, Windows GPU, Herdr or Vietnamese /voice run | Pending; Windows CI compilation/tests are not native usability acceptance |

[Sanitized run evidence](evidence/cloud-live-run.json) retains both soaks, sample vectors,
asset hashes, final checks and all stated limits. Real Codex app-server control-plane
selection of two threads passed without requesting inference; that is not a model turn.

Body-only, camera-off visual comparison: [historical sphere](evidence/cloud-live-before.png),
[declared resting face](evidence/cloud-live-face.png), and [bird fixture](evidence/cloud-live-illustration.png).
The illustration was deterministic, not model-authored. Restoring the face was
also applied successfully; no page errors or active camera in the comparison.

No claim is made that ordinary conversation semantic expressiveness is fixed:
its decisive real-model gate is blocked. Explicitly separate attempted,
rejected, admitted, applied, frame submission, frame/hash change proxy, relevance
and semantic consistency. The holdout driver leaves visual meaning/relevance/
consistency unscored rather than inventing them from transport success.

Targets remain >=24 inference Hz, >=50 render FPS, confirmed-event reaction
<150 ms (excluding debounce), output activity <250 ms with <=600 ms decay,
>=30-minute stability with <100 MB GC-normalized retained private growth,
actual-person observation accuracy >=8/10 and blinded human theme recognition
>=6/10. Frame statistics are rolling 120-frame windows, sampled during the soak;
they are not a global run percentile. Missed Cloud software-rendering targets
remain misses. Preserve all existing native records and their limitations.

## Fisch Live feature-branch acceptance (2026-11-08)

Implementation and per-commit evidence are tracked in [the Live plan](fisch-live-plan.md); usage/privacy and authorized scope are in [the Live guide](fisch-live.md). The later sections below retain their historical scope.

- Final complete JS regression: 221 tests / 41 files passed with `--maxWorkers=1`; 16 Rust tests, frontend production build and architecture boundary passed. This includes vision-recovery and browser/worker-CSP regressions.
- Real signed-in Codex exercised synthetic MCP observe/look and read a random image code correctly. The interactive Herdr Live pane called observe/express/look and obtained an admitted expression; a normal first-tool approval was used, never bypassed.
- A separate native Codex synthetic sailboat request produced a six-part assembly accepted by the shared compiler. This demonstrates generation/compilation, not human theme recognition.
- Sanitized [functional evidence](evidence/live-acceptance.json) records cold observe separately (78.8 ms); warm observe p95 was 5.2 ms and expression admission p95 29.0 ms. This was a software-rendered browser run, not native GPU certification.
- Camera permission/acquisition, GPU landmark output, CPU operation and bounded GPU-to-CPU recovery have individual evidence. Some short combined-GPU probes ended the track; subsequent native GPU runs stayed active for several minutes. The interrupted/stopped attempts are not counted as 30-minute camera acceptance.
- SDK inspection exposed a logging endpoint; the final browser/worker policy blocks off-machine connections. A regression verifies both main-thread and worker fetch are denied. No real camera image was used in model vision tests.
- [Native camera/GPU soak](evidence/live-soak.json) completed 1,801 seconds after 60-second warm-up: camera continuous, 15 topology/cancel/resize cycles, no script errors, unexpected transport frames or off-loopback requests. GC-normalized private growth was 37.3 MB and heap growth 87.1 KB. Sample mean FPS ranged 58.0–60.0; rolling frame p95 ranged 17.1–29.4 ms, so a consistent <=20 ms gate is not certified. Vision remained approximately 9–10 Hz, below the 24 Hz target. Camera was stopped at teardown.

PRD gates still requiring manual or broader evaluation: observed-state accuracy >=8/10, blinded theme recognition >=6/10, native prompt-context hook trust/delivery, Vietnamese /voice, sustained distraction and an accurate Herdr output stream. Input-by-text and experimental/off output rhythm are the user-approved fallback. Additive transforms, condition-based reflex rules, arbitrary geometry/macro reflex actions and real-camera look delivery are outside this bounded implementation. Vision throughput around 8–10 Hz in short probes does not meet the 24 FPS target.

## Documentation reconciliation checks (2026-11-08)

This docs-only update was checked against implementation commit `9863ba3`. Relative link paths, UTF-8, `git diff --check` and `npm run check:architecture` passed. `npm test` passed 194 of 195 tests; the launcher cleanup test timed out navigating to local Vite before reaching its synthetic host failure. Rerunning `npx vitest run tests/launcher.test.mjs --maxWorkers=1` passed all three launcher tests. This is not a clean single-run full-suite pass or a native visual/performance acceptance result. No runtime source was changed.

## Historical initial baseline

Date: 2026-11-05. Environment: Windows x64, Node v24.15.0, Rust 1.97.1, Chromium headless with SwiftShader. Native GPU/WebView performance hardware characterization has not been completed.

| Check | Observed result |
|---|---|
| Unit/integration tests | 25 tests passed: byte splits/UTF-8, invalid input, macro revision/typing/cycles, timing, conflicts, continuity, stale epoch/seq/TTL, state patches, queue bounds, replay, published schema contracts and HTTP/MCP IR equivalence |
| Simulated overload | 3,000 records over 30 simulated seconds; queue ≤8, cache ≤64; rejections counted; cancellation clears queue |
| Core dependency boundary | Passed; no DOM, Worker, Tauri, provider or Three.js import in core |
| TypeScript + Vite production build | Passed; Three.js bundles exceed 500kB warning threshold |
| Rust/Tauri Windows `cargo check --locked` | Passed |
| Windows executable | `tauri build --debug --no-bundle` succeeded; native UI/gateway end-to-end visual acceptance remains unverified |
| Rust gateway tests | 4 passed: auth/origin/host, single controller, dedup, admission-only ACK, cancel/stale epoch, mailbox/deadline/body bounds and SSE gap/snapshot |
| Browser smoke | Offscreen worker and main-thread fallback initialized; cancellation, invalid DSL, valid morph, toggles and 375px layout passed; no page errors |
| Dependency audit | npm audit: 0 vulnerabilities after patch upgrades |

The browser smoke result in [evidence/browser-smoke.json](evidence/browser-smoke.json) contains a short rolling headless frame interval p95 around 31.9ms. It does not meet a ≤20ms interpretation and is not a native GPU benchmark. No production performance pass is claimed.

## Acceptance gaps at this snapshot

- M1: substantial implementation and deterministic tests; visual pair matrix and full schema/template edge cases remain to be expanded.
- M2 (SRS v0.3): local HTTP/SSE gateway, pairing, MCP/tool adapter, instruction bundle and TS helper implemented and tested with fake hosts. Not fully accepted: production host compatibility and human expression perception remain open. Windows Codex pane attachment and native planner inference have recorded evidence. The core needs no model key; the optional pane API planner is implemented separately from the gateway.
- M3: Tauri Channels, bounds, Worker/fallback and basic recovery implemented. Native executable build is checked separately. Native visual/recovery matrix, actual overload responsiveness and 20-minute soak remain unverified.

Fisch does not persist raw planner messages; bounded redacted interaction text is sent to the selected inference provider. Reference replay capture is explicit opt-in. Default counters exclude prompt and credential payloads. Screenshots show only generic scripted prompts. The source SRS attachment, local credentials, caches and build outputs are excluded from the public Git repository.
