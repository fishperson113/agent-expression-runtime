# Data-only reactive Responses adapter

Live terminal wiring uses this separate data-only adapter for explicitly configured
reactive inference; it defaults off. Camera decisions never enter the Native coding
thread. This contains the shared-thread capability route; the historical unrelated
output's cause remains unproven, and real-provider semantic acceptance is pending.
Tests use injected responses and loopback fake HTTP without production model budget.

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
The production request presenceRevision is a nonnegative integer. Existing Live
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
queued unsent input. Live terminal wiring uses this broker; these integration
checks do not establish real-provider semantic acceptance.

Every broker page evaluation has a 10-second bound (tests can inject a shorter
positive timeout), with at most four outstanding waits. Any browser error or
timeout permanently latches browserUnavailable for that broker: no further page
evaluations, reactive dispatch or controlled native forwarding occurs. Waiting
native requests receive explicit RPC errors; late barrier resolution cannot
forward them. Initialize and other noncontrolled native RPCs still pass through.
Close rejects outstanding waits and clears their timers. Recovery requires a
broker/browser restart and reconciliation of unresolved provider transport; a
later successful page promise does not automatically reopen the failed broker.
Already-issued Playwright calls cannot be recalled, so browser generation, TTL
and consent checks remain mandatory for any callback that eventually arrives.

`createLiveReactiveProvider(env, {fetch, now})` prepares this provider on Node only.
It additionally requires `FISCH_REACTIVE_BUDGET` to name an absolute path to the
existing approved cumulative budget ledger. It never creates or resets a ledger,
changes its deadline, or increases its limit. Missing, unreadable, invalid,
expired or exhausted ledgers leave the provider unavailable with a fixed reason;
native CLI input remains independent. An atomic reservation rechecks the same
ledger immediately before each HTTP request, including after startup validation.
No retries or replacement ledgers are created after denial.

The factory returns only `{provider, reason}`; it does not expose configuration,
credentials or the ledger path as browser metadata. `nativeLiveEnvironment(env)`
returns a copy excluding every `FISCH_REACTIVE_*` variable before launching the
native Codex child. It preserves other existing environment variables without
modifying global settings, login state, or the caller's environment.

The Node broker validates the complete candidate and compares its outer request
with observationWindow.request before browser authorization or provider use.
Schema/session/epoch/request IDs, intent/presence revision, deadline and required
track set must match; unknown request fields fail closed. The copied candidate
is frozen so authorization cannot race a changed transport payload. Production
windows require presenceRevision and at least one event and observation. Invalid
windows consume no provider reservation or network request. Legacy offline host
contracts can retain optional presence independently of this production boundary.

## Optional provider receipts

`decide(window, signal, onReceipt?)` optionally reports one immutable metadata
receipt after an attempted HTTP request finishes or becomes unknown. No callback
means no receipt hashing or diagnostic clock work. Budget/preflight denial and
abort before fetch produce no receipt and do not pretend a request was sent.
The callback is trusted application code; its exceptions, rejected promises or
attempts to mutate the frozen receipt cannot change the returned decision/error.
No receipt is automatically stored or logged, and no browser wiring is added.

Fields are requestId, modelConfigHash, promptHash, requestHash, responseHash,
outcome, durationMs and usage. SHA-256 model configuration covers model,
endpoint and advertised capabilities, excluding credentials. Prompt hash covers
sent static instructions and schema; request hash covers the actual sanitized
HTTP body, excluding headers. Only hashes are returned, never those inputs.
Response hash covers bounded parsed JSON serialized again, not original wire
bytes. It is null when parsed JSON is unavailable, including HTTP failures whose
bodies are cancelled. Hashes remain linkable metadata, not an anonymity claim.

Outcomes are completed, invalid_response, http_error and transport_unknown.
Duration uses a monotonic clock across HTTP/read/validation and excludes callback
execution; an invalid diagnostic clock yields null, never a fabricated zero.
Usage contains only provider-reported safe nonnegative integer input_tokens,
output_tokens and total_tokens, otherwise the whole usage value is unknown.
Missing/error usage never becomes zero; receipts do not claim billed costs or
confirmed cancellation. Names follow the official
[Responses usage type](https://github.com/openai/openai-node/blob/2528b6db07b842d1d779bb0a84ddf55120cfdff7/src/resources/responses/responses.ts).

Receipt completion follows the transport promise/reader; this instrumentation
adds no timer, cancellation authority or retry. If an injected transport ignores
abort and hangs, no receipt is emitted until it settles. The existing broker's
30-second watchdog independently marks the request unknown. A later completed
provider receipt does not restore revoked browser authority or confirm that an
action ran. durationMs is a Node monotonic delta, never an absolute timestamp or
a claim that Node and browser clocks are synchronized.

`freezeReactiveReceipt(value)` is the exported Node metadata boundary. It rejects
unknown fields, invalid IDs/hashes/outcomes, nonfinite or negative durations,
unsafe token counts and accessor properties without reading their values. It
returns a fresh deeply frozen projection; producer callbacks use the same
validator. Future brokers must validate receipts again before queuing them.
