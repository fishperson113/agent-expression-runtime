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

## Primitive contract

Follow-up corrections: upright wall/cloud/pyramid preserve each sphere particle's latitude; pyramid taper remains upright. Camera distance adapts to portrait aspect ratios and a uniform body fit keeps transformed particle centers within 88% of the view. Perspective point-size gain is bounded to 0.75–1.25. This containment can reduce extreme grow/translation combinations; raw target parameters are not a promise of unbounded screen displacement. `shapeQuality` programs blend back to their baseline over 250ms, and cancellation/session epoch changes restore neutral posture. Scheduler weights and renderer buffer order follow the shared manifest. Geometry/projection and scheduler regressions cover these properties; perceptual evaluation remains separate.

Removed `ring` with no compatibility alias. `wall` is an upright thin plane. Shapes are sphere (ball-like), wall, pin, screw, pyramid, plus wave/cloud. This is a breaking POC vocabulary change. There is one particle body, not multiple composited objects.

`shapeQuality` uses absolute bounded rise/advance and spread/grow targets. Signed translation gives sink/retreat; scales below one give enclose/shrink. Spoke/arc paths and continuous Effort time/weight/flow are defined in [admission](admission.md). They are POC transfer functions, not a claim of psychological validity. No fixed emotion, color or shape mapping is installed.

## Practical limits

`pending` occupies one of four slots until a definitive decision or closure; a failed renderer may require explicit release/reconnect. A normal tool host can serialize text and tools. Browser output is in a browser window; terminal panes show textual controls/receipts. Native WebView visual acceptance, full GPU recovery matrix, long memory soak and performance certification remain unverified. The existing pre-compilation state-overflow policy still drops explicitly rather than coalescing all patches; this was already documented as a POC limitation. No evaluator or real-model call is included. No host configuration or persistent credential was installed.
