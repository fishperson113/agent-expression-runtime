# Architecture

The core is independent of Tauri, DOM, Workers and Three.js. The composition root connects a provider adapter, bounded compiler host, scheduler and renderer sink. `npm run check:architecture` enforces the core boundary.

- `contracts`: versioned wire schema and capability manifest.
- `core/ast`: discriminated data types, no executable model code.
- `core/compiler`: strict validation, immutable session macro revisions, bounded expansion, temporal write conflict checks, IR lowering and 64-entry cache.
- `core/runtime`: a single body track, replace/append policy, epoch and sequence checks, monotonic timeline, property baseline release and deterministic shape weights.
- `adapters`: JSONL byte framing, scripted provider, Tauri transport and Three.js renderer.
- `workers`: compiler host, render host and actual OffscreenCanvas/WebGL probe.
- `app`: ownership, lifecycle, mailbox limits, recovery and UI intent wiring.

The compiler mailbox has four in-flight jobs. The render mailbox has four acknowledged messages. Renderer queues have eight pending programs; overload is rejected and counted. Rust uses separate 64-message content and four-message expression permits, with frontend acknowledgement. Content may backpressure its own provider but never waits for the expression compiler or renderer. Cancellation has a direct command/message path; every consumer checks epoch again.

Morphs interpolate four procedural shape weight vectors over stable seeded particle IDs. Replacement captures the current weights, preserving continuity. Geometry buffers are allocated once; lowering is outside the frame loop. Color interpolation is linear-light sRGB conversion. Quality selection retains the first stable particle IDs.

Default telemetry is numeric counters and error codes only. Prompts stay in the conversation UI; they are not sent to a service in this POC. Replay capture requires a checkbox and retains at most 1,000 normalized records in memory. Export is a deliberate local download.

The primary mode is an external agent using the loopback Rust gateway. HTTP POST and MCP share the same frontend Worker compiler and scheduler; there is no model SDK or model API call. Gateway admission waits at most 500ms for compile/scheduler ACK, never for animation completion. The frontend applies a 450ms admission deadline before forwarding IR. SSE reports separate lifecycle feedback through a 64-event bounded broadcast; four consumers maximum. Control messages use one acknowledged slot and one coalesced latest epoch, independent of expression capacity. Request dedup retains at most 256 receipts for 60 seconds.

The optional capability demo is authored choreography, not model-selected behavior. First real host selection and a real agent demo remain open; fake MCP/HTTP tests do **not** establish full M2 acceptance. Direct provider API transport is optional and unimplemented.

Known limits: template validation uses context-sensitive representative values, with full validation again on expansion; complex parameterized nested calls need broader testing. State patches are merged into scheduler baselines, but saturated pre-compilation state jobs are explicitly dropped rather than coalesced. Renderer worker recovery falls back once to a main-thread renderer and currently restarts from baseline; context-loss GPU recovery relies on Three.js and stops rendering after the bounded restore budget. These are POC limitations, not completed SRS guarantees.
