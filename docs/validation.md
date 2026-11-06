# Initial baseline validation record

This page records the original baseline. The current local review changes and live browser/CLI evidence are listed in [review remediation](review-progress.md) and [browser bridge smoke](evidence/browser-bridge-smoke.json).

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

## Milestones

- M1: substantial implementation and deterministic tests; visual pair matrix and full schema/template edge cases remain to be expanded.
- M2 (SRS v0.3): local HTTP/SSE gateway, pairing, MCP/tool adapter, instruction bundle and TS helper implemented and tested with fake hosts. Not fully accepted: first real host and real agent demo are unselected. App does not need a model key. Optional direct API mode remains unimplemented.
- M3: Tauri Channels, bounds, Worker/fallback and basic recovery implemented. Native executable build is checked separately. Native visual/recovery matrix, actual overload responsiveness and 20-minute soak remain unverified.

Default logs exclude prompt, token, AST and credential payloads. Screenshots show only generic scripted prompts. The source SRS attachment, local credentials, caches and build outputs are excluded from the public Git repository.
