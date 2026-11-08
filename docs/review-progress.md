# Review remediation ledger

This ledger records review findings and validation evidence. Publication status belongs to Git history and remotes, not this document. It does not establish full SRS performance acceptance.

| Review | Change | Evidence |
|---|---|---|
| 1 Session macro leakage | Explicit registry reset on session creation/closure; committed macros survive epoch cancellation within that session | Worker-host tests and real browser session isolation smoke |
| 2 Premature define commit | Bounded definition drafts reserve names and commit after scheduler admission; rejected/expired drafts are discarded | Definition transaction tests; rejected definition retry in browser smoke |
| 3 Timeout receipt race | Delayed decision is `pending`, never synthetic rejection; delayed ACK remains tracked and dedup retrieves its final result | Real 650ms ACK delay smoke: pending -> accepted |
| 4 MCP stale session | Definitive lifecycle errors clear cached session for the next call, without replaying uncertain commands | Real MCP revoke/reconnect smoke |
| 5 Lease from creation | Inactivity lease refreshes on activity; expiry revokes and drains old session | Rust lease regression |
| 6 UI revokes host | Expressions toggle cancels body work without revocation; demo refuses to take over an external controller | Real browser UI retention smoke |
| 7 CORS preflight | Token-free OPTIONS validates exact Origin, methods and headers; real requests still require auth | Rust CORS regression and live browser bridge |
| 8 Orbit angle jump | Integrates bounded dt into owned phase | Long-uptime phase tests |
| 9 Field switch jump | Crossfades field weights from current mixture while retaining integrated orientation | Flow transition tests |
| 10 Ineffective cache | Cache lookup precedes lowering; registry revision replaces full-registry stringification | Lowering spy and mutation-isolation test |
| 11 Dead compiler | Exhausted restart budget fails immediately; restarting a compiler closes its external session | Worker crash regression |
| 12 SSE permit leak | Closure event ends stream; lagged obsolete sessions also terminate | Six-session Rust consumer-permit regression |
| 13 Missing cancellation | Scheduler emits terminal cancellation for active/queued work and pending state; gateway accepts old-epoch cancellation for known receipts | Scheduler feedback tests and live SSE cancellation smoke |
| 14 False state completion | Completion waits until ownership is released, blends finish and actual values match targets; superseded receipts cancel | Feedback regression |
| 15 Rate quota on queue failure | Queue rejection precedes admission quota consumption | Full queue followed by valid replace regression |
| 16 Duplicate capabilities | Rust and TS consume the same manifest | Shared-manifest Rust and compiler contract tests |
| 17 Text 4xx parse errors | HTTP wrappers emit stable error codes instead of SyntaxError or extractor text | Client error tests |
| 18 Fixed seed | Configurable body seed is passed to compiler and both renderer hosts; browser accepts uint32 `?seed=123` | IR seed and deterministic geometry tests |
| 19 Missing cross-layer tests | Live Rust gateway + browser Workers + renderer + HTTP + MCP + CLI exercise lifecycle and delayed ACK | `scripts/browser-bridge-smoke.mjs` and JSON evidence |

## Current implementation at `9863ba3`

The ledger above records earlier fixes and their evidence; it is not a fresh run or full acceptance report. The default workflow is `fisch run` beside an existing Codex/Claude in Herdr. It attaches without an injected prompt, browser launch or main-agent tool call. Launch reads provider/Herdr settings without modifying them. Native interaction hooks are explicitly installed; Codex requires native trust in `/hooks`.

Herdr lifecycle events supply activity. Native hooks supply actual user messages and recognized task results; terminal excerpts are not planner input. Immediate local attention runs before background inference. Codex uses a warm app-server with ephemeral request threads; Claude uses noninteractive processes. API planning is optional and implemented separately from the core. Per-turn budgets, stale-result rejection and cancellation are described in [the planner guide](expression-planner.md).

The particle body supports legacy primitives and free-form assemblies with stable part IDs, independent motion and bounded target-aware boids. Local presence and model-authored part performances continue without idle model calls. Up to three prepared idle scenes can replace full geometry and show short in-pane captions; resumed activity restores the interaction program. New messages, accepted manual replacement and cancel clear earlier continuation. Scenes remain in memory. There is no automatic 30-second idle freeze. `FISCH_MOTION` controls normal/reduced/off independently of inference.

The installed Herdr preview uses adaptive colored Braille with density sampling, smoothed exposure/color, fixed Bayer dithering and hysteresis. Inline RGB is selected only when supported; disabled graphics stays disabled. The launching-shell option `FISCH_BRAILLE_STYLE=peak` retains the earlier sampler. See [current rendering and idle evidence](related-work.md#10-cập-nhật-braille-theo-thời-gian-và-idle-scene-tự-do).

## Protocol and geometry guarantees

The MCP adapter restores acknowledged immutable macros after session recreation and retries only definitive rejections. Uncertain commands are not automatically replayed. Compiler AST paths survive transport and dedup. Admission `pending` is distinct from rejection; watchdogs bound unresolved work. See [admission](admission.md) and [HTTP/MCP integration](integration.md).

One body may contain multiple geometric parts. `ring` has no compatibility alias; the seven legacy targets are sphere, wall, pin, screw, pyramid, wave and cloud. `shapeQuality` uses bounded absolute posture/scale targets and POC Effort transfer functions. Framing reserves growth headroom while containing extreme combinations. Spatial assignment is approximate, and boids do not guarantee collision avoidance. See [geometry scope](swarm-geometry.md).

## Remaining acceptance work

Windows Codex attachment and signed-in native planner outputs have recorded evidence. Native Claude hook payloads and planner inference have also been exercised, but interactive Claude-in-Herdr delivery remains unverified. Live Linux/macOS pane checks, native WebView/GPU recovery, inline pixel inspection, sustained memory/performance acceptance and human assessment of legibility, relevance and distraction remain open.

Earlier test counts and browser captures describe their recorded runs. Ignored `.runtime/` experiments are not portable committed evidence. Neither synthetic hook tests nor compilation success certifies human expression perception. See [validation scope](validation.md), [Linux historical validation](linux-validation.md) and [acceptance procedure](benchmark.md).
