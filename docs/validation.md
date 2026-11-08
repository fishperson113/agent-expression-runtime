# Validation scope and evidence

The current implementation includes pane attachment, native interaction hooks, contextual planning, continuous presence, model-authored performances, adaptive Braille and prepared idle scenes. See [current behavior](expression-planner.md), [review remediation](review-progress.md) and [research/evidence limits](related-work.md#10-cập-nhật-braille-theo-thời-gian-và-idle-scene-tự-do). Test counts below are historical observations, not the current suite size or a fresh certification.

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
