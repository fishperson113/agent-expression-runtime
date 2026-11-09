# Data-only reactive Responses adapter

This adapter is not wired into Live. It does not enable inference or resolve
PR #51's autonomous acceptance blocker. Current tests use injected responses and
a loopback fake HTTP server; they consume no production model budget.

`reactiveProviderConfig(env)` defaults off, even if OPENAI_API_KEY or a planner
backend exists. Explicit FISCH_REACTIVE_BACKEND=responses, FISCH_REACTIVE_MODEL
and FISCH_REACTIVE_URL select a backend. FISCH_REACTIVE_API_KEY is separate;
OpenAI requires it. No credential is copied from Codex, read from a login store,
or installed. HTTPS or loopback HTTP without embedded credentials/query/hash is
accepted; redirects are forbidden. Configure only an approved provider endpoint.

`reactiveResponsesAdapter(config, {reserve, fetch})` requires a reservation
callback before any fetch. It receives requestId and must explicitly return true
after reserving the authorized budget; false, rejection or missing acknowledgement
prevents dispatch. There is no retry. Abort/network/read failure does not establish
provider completion or zero usage. The caller must preserve the decision host's
uncertainty latch and obtain genuine settlement evidence before reopening it.

`decide(window, signal)` takes schemaVersion=1, causal request, events and
observations. Events use numeric `id` (map existing gateway `seq` explicitly),
a supported geometric event type and timestamp. Maximums: eight events, four
observations, sixteen required tracks and 64 KiB serialized sanitized window.
The optional request presenceRevision is a nonnegative integer. Existing Live
observation JSON schema validates structured fields. Observation summary is
removed; unknown context fields such as transcript/history are rejected.
The complete sanitized window is copied and recursively frozen before reserve.
The integration must pass the same frozen request to the causal host; this
adapter does not itself implement freshness, presence or execution ownership.

The HTTP body is constructed from fixed fields only: model, store=false,
tools=[], tool_choice=none, bounded max_output_tokens, constant instructions,
serialized window and strict decision schema. No coding thread, conversation,
previous_response_id, app-server, process, MCP or tool executor participates.
Only Content-Type and explicitly configured Authorization headers are authored.
No input, output, key, reasoning content or chat transcript is logged.

Output is at most 65,536 bytes. Exactly one completed assistant message with one
output_text must parse as a strict decision. At most three known reasoning
metadata items may accompany it and are discarded. Tool calls, refusals,
incomplete/multiple messages, prose and mismatched request IDs are rejected.
Observe requires null action. Express uses the finite existing expression-plan
DSL subset, including generated assemblies; no keyword-to-effect table exists.
This is not the complete Live-control DSL. The shared LiveCompiler and causal
host must still validate and admit the final decision before any execution.

Provider failures now carry a `ReactiveProviderError` with a fixed code and
transportSettled flag. Preflight denial, complete invalid response and an HTTP
error response are settled; network/read/abort during fetch and over-limit
streams remain unknown. Neither a settled error nor success implies zero cost.
The broker trusts this class rather than inferring settlement from error text.

`LiveReactiveBroker` is the trusted Node/browser bridge, not an HTTP server. It
pulls one request, obtains a consume-once browser authorization immediately
before dispatch, then gives only observationWindow to the separate provider.
A failed authorization delivers null and makes no provider call. User input
awaits browser revocation before its original native RPC is forwarded. Native
input remains independent when provider transport is unknown. Native steer must
match the selected native thread and expected turn before and after the barrier.

Reactive transport stays occupied across browser revocation. Its 30-second
watchdog aborts only that provider and latches uncertainty; it never interrupts a
native turn. Definitive errors deliver null to release the browser request.
Unknown errors call failReactiveDecision and block new provider requests. Budget
denial pauses automatic dispatch instead of retrying every poll. Returned data
never becomes a native chat message or app-server turn. Queue, request receipts,
native pending IDs and completed-turn history are bounded and held only in
memory. Close invalidates late callbacks, aborts active transport and rejects
queued unsent input. Wiring and live acceptance remain separate work.
