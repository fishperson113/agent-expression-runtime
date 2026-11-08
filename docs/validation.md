# Validation scope at implementation commit `9863ba3`

The current implementation includes pane attachment, native interaction hooks, contextual planning, continuous presence, model-authored performances, adaptive Braille and prepared idle scenes. See [current behavior](expression-planner.md), [review remediation](review-progress.md) and [research/evidence limits](related-work.md#10-cập-nhật-braille-theo-thời-gian-và-idle-scene-tự-do). Test counts below are historical observations, not the current suite size or a fresh certification.

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
