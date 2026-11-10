# Optional realtime component reuse experiment

Prefer the existing Native agent plus Fisch's capability engine. The demonstrated
reusable addition is **XState's Node actor runtime**, not a replacement agent,
voice stack, memory service or VTuber application. This research directory is
inactive: neither the root package nor production host imports its dependency.
Nothing is enabled by default. The candidate is not production-adoption ready.

| Candidate | Exact source / license | What actually ran | Decision in this scope |
|---|---|---|---|
| XState 5.33.4 | [release commit](https://github.com/statelyai/xstate/tree/bd77717b8d33c49af1c8ee4a7e22cebb936cc8b1), [MIT](https://github.com/statelyai/xstate/blob/bd77717b8d33c49af1c8ee4a7e22cebb936cc8b1/LICENSE) | Actual `createActor`, invoked promise actors, cancellation signals and retained context counters, around existing Fisch ownership classes | Useful small orchestration component to investigate; keep authority and agent memory in the existing host |
| Open-LLM-VTuber | [992309c](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/tree/992309c0aa19845960228f880013d4685fde93b5), backend MIT with separate Live2D sample terms | Actual interface/DTO imports and concrete `StreamJSONDetector`; full `BasicMemoryAgent` not executed | The interface alone is not backend behavior reuse; the tested detector fails strict parser requirements |
| Pipecat | [dea6543](https://github.com/pipecat-ai/pipecat/tree/dea65430bed0f3d1317a66d2edd200263ab8b67d), BSD-2-Clause | Source/dependency inspection only; not installed or run | A real frame/voice pipeline alternative, but no demonstrated reason here to replace an existing Node agent host with another provider/media pipeline |

XState's rolling main was v6 beta at inspection time; this package deliberately
pins stable 5.33.4 and its npm integrity in the optional lockfile. It has zero
runtime package dependencies. The Open-LLM project declares 35 dependency entries,
including platform-specific alternatives, and Pipecat declares 22. These counts
are source facts, not measured installation time, download size or memory usage
of either complete backend. No full backend installation was attempted.

Open-LLM's actual `AgentInterface.chat(BatchInput)` streams `SentenceOutput` or
`AudioOutput`, with `handle_interrupt(heard_response)` and history-loading hooks.
Implementing those abstract methods oneself would not prove reuse of its memory
or interruption implementation. In the minimal Loguru-only environment,
`BasicMemoryAgent` import stopped at the missing Anthropic dependency; its setup
and runtime cost remain unknown. That does not establish that the project is
unusable. Its actual detector parsed fragmented simple JSON, but failed valid
JSON containing a closing brace inside a string. It also retained 16,384 bytes
of plain input until caller reset and emitted an input excerpt in a warning.
These are concrete reasons not to substitute that detector for Fisch's existing
bounded strict tool protocol. The probe uses only public canaries.

Do not treat the whole Open-LLM stack as MIT. The backend excludes Live2D samples.
Its pinned frontend build submodule `06a659b114fff788cf0daaa86e484576db4975bf`
contains bundles without a root license file. The separately inspected frontend
[source license](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/d176e7df2366952e3bacbf12cf9a8b18a4315932/LICENSE)
is a custom license with additional commercial conditions. No frontend, Live2D
model, artwork, weights or voice component is copied into this experiment.

The Node port uses current `LiveOutput`, `LiveConversation`, owned transport and
`LiveReactiveBroker`. A trusted facade records the **correlated raw owned RPC
receipt for each invocation**. It never samples global `output.turn` after an
await to guess which turn a request owns. Cancel compares that receipt's thread
and turn to canonical host state immediately before the synchronous controller
call; the controller still performs its own post-barrier checks. The facade adds
no authority, model, tool permission, hidden thread or second conversation memory.

Two earlier adapters failed adversarial review and are deliberately rejected:

- Generation-only browser cancellation could stop a newer turn in the same
  generation after an old actor's cancel was delayed. The browser API is a human
  **stop-current** control, not an owner-scoped machine cancellation capability.
- Even a synchronous check was insufficient when expected ownership was first
  inferred from global state after a late ACK. Completion-before-ACK plus a newer
  turn could attribute the old request to the newer owner.

The maintained Node probe tests both orderings using the actual owned relay and
canonical classes. Cancel before a receipt is available remains **unknown**, with
no claimed interruption or automatic replay. Resetting actor state cannot clear
`LiveConversation`'s sticky unknown state. The maintained browser capability probe
has no machine CANCEL connection to the human browser API.

From the repository root, install the normal locked Fisch dependencies first,
then the optional one-package project:

```sh
npm ci
npm ci --prefix experiments/realtime-reuse --ignore-scripts
npm test --prefix experiments/realtime-reuse
```

The default optional test also runs six Node-only startup/cleanup controls. Readiness races against host settlement, keeps a bounded timer, and clears it on every outcome. Cleanup attempts all owned actions, exposes normal failures and preserves the primary error. Missing-cargo/browser platform combinations are not exhaustively tested.

The default optional actor test is Node-only and uses a public scripted app-server,
not Codex inference. It checks three-turn synthetic history roles and a public
fact hash, session B isolation, confirmed interruption, late callback arrival
and rejection, both ownership races, early cancellation uncertainty, and no
private owned ACK forwarded to the synthetic Native client. This does not prove
real-model coherence or that a tool result entered a real model's context.

For actual page / gateway evidence, use the existing platform prerequisites and
installed Playwright Chromium. The runs remain camera-off and `assets:false`:

```sh
cargo build --locked --no-default-features --bin fisch-gateway --manifest-path src-tauri/Cargo.toml
npm run test:browser --prefix experiments/realtime-reuse
npm run test:capability --prefix experiments/realtime-reuse
```

`PLAYWRIGHT_BROWSERS_PATH` may be set to the locally installed browser directory.
`FISCH_REUSE_RESULT` optionally writes one JSON result to a caller-selected path;
otherwise results are printed. Do not publish transcripts or credentials. Each
run creates only ephemeral loopback pairing credentials, supplies a scripted
host and disables the observer. It does not request account credentials, enable
media, reset a budget ledger, or contact a hosted model. Setup downloads from
GitHub/npm/PyPI are distinct from the measured loopback-only runtime observations.

The capability probe runs the actual launcher, canonical conversation binding,
scripted Native fixture and its configured MCP server. It creates two novel
parts, changes only one declared center, then undoes. Real `playground_state`
results must have revisions 1/2/3 and the expected canonical scenes. It also
requires matching native epoch/sequence application, completion and frame-proxy
feedback. No keyword or emotion-tag effect table is introduced. This proves the
injected full-scene capability path, not autonomous creativity or enjoyment.

To repeat the separate Open-LLM negative probe, checkout the documented upstream
revision outside the Fisch tree and use an isolated Python 3.12 environment with
`loguru==0.7.3`. No other backend dependency or model is required:

```sh
python experiments/realtime-reuse/openllm-probe.py --source /path/to/pinned/Open-LLM-VTuber
```

Exit zero means the inspection completed; the JSON's detector verdict remains
FAIL. Never interpret that exit code as full upstream application acceptance.

[Frozen evidence](evidence/realtime-component-reuse.json) retains source hashes,
normal-path successes, rejected adapters and limits. One fresh optional package
install took 0.595 s with metadata already queried; installed XState occupied
2,672 KiB. A separate import observation was 34.4 ms (cached import 0.076 ms),
with 29,256 KiB parent peak RSS. These are single component observations, not
full-app startup benchmarks. Probe runtime/RSS/CPU include different harness work
and are reported separately. Browser runs used Linux headless Chromium/software
rendering; parent RSS/CPU exclude browser/gateway children. Process-tree peak RSS,
full Open-LLM/Pipecat costs, Windows acceptance and human 10–20 minute enjoyment
are **unknown or not run**, never zero or passed. Frame proxies do not prove meaning.
