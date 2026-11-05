# Agent Expression Runtime

A provider-independent, Windows-first Tauri + TypeScript runtime: a particle body controlled by a bounded, declarative JSON AST. External agents connect through authenticated local HTTP/SSE or the MCP adapter. No model account, model SDK or API key is required.

![Browser sandbox](docs/evidence/browser-desktop.png)

## Run

Requires Node.js 22.12+ (or 24), npm, and for desktop Rust stable, Microsoft C++ Build Tools and WebView2.

```sh
npm ci
npm run dev
```

Open the printed local URL. Start a scripted turn, cancel it, submit a JSON program, inspect capabilities, change quality, or opt in to expression replay capture.

```sh
npm run tauri -- dev
```

The desktop app starts a loopback-only gateway and shows pairing details on demand. Follow [external agent integration](docs/integration.md) for HTTP, the TypeScript helper and MCP stdio adapter. The body works without the conversation demo. Browser mode and the optional conversation demo use scripted adapters. **No mode calls a model.** No paid services are configured.

## Validate

```sh
npm test
npm run check:architecture
npm run build
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Browser smoke test: start `npm run dev`, install Chromium with `npx playwright install chromium`, then `node scripts/browser-smoke.mjs`. `CHROME_PATH` may point to an existing compatible Chromium. The smoke test writes screenshots and a JSON result to `docs/evidence/`.

## What is implemented

- Strict envelope/AST validation, byte-limited UTF-8 JSONL framing and atomic rejection.
- Sequence, parallel, wait, immutable versioned define/call macros, bounded compiler cache and resource checks.
- Monotonic scheduler, property conflict detection, epoch cancellation, stale sequence/TTL admission, bounded append queue, replacement from displayed morph weights and baseline patches.
- Seeded sphere, ring, wave and cloud with orbit, turbulence and pulse; color, point size, brightness and dispersion.
- Worker compiler, feature-tested OffscreenCanvas renderer, main-thread fallback, reduced motion and manual particle quality tiers.
- Separate content/expression adapter APIs, bounded/acknowledged Tauri IPC, privacy-conscious counters and explicit opt-in replay.
- Loopback Rust HTTP gateway with ephemeral pairing token, strict Origin/Host policy, single-controller sessions, dedup, admission deadline and bounded SSE feedback.
- TypeScript host helper, minimal MCP stdio tools/resources and versioned agent instruction bundle; external model credentials never enter the runtime.
- GitHub Actions for unit/build/boundary checks and Windows Rust compilation.

## Status and acceptance

This is an initial POC implementation, **not a claim that M1–M3 or performance acceptance are complete**. See [validation](docs/validation.md), [architecture and known limits](docs/architecture.md), and [benchmark procedure](docs/benchmark.md).

First real agent-host selection/demo, token overhead measurement, native visual checks, 20-minute memory soak and target-machine performance acceptance remain open. Direct model API mode is optional and unimplemented. Headless browser tests cannot certify Windows WebView/GPU behavior. The source SRS attachments are deliberately excluded from the public repository.

Product-code license remains undecided. This public repository is a source preview, not a completed OSS licensing release. Dependency licenses and the original generated icon remain separate; no license was silently inherited from another repository.

## Example

```json
{"v":1,"epoch":"runtime-assigned","seq":1,"kind":"program","track":"body","policy":"replace","body":{"type":"parallel","children":[{"type":"morph","target":"ring","durationMs":900},{"type":"flow","field":"orbit","strength":0.35,"durationMs":1800}]}}
```

Epoch and sequence must be assigned by the application adapter, not trusted from a model. Expressions are selected behavior, not evidence of internal emotion. Input can never supply JavaScript, Rust, shader code, I/O or recursion.
