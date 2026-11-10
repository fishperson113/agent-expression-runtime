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

## Explicit version-2 brief decisions

FISCH_REACTIVE_CONTRACT_VERSION=2 opts into the coordinated V2 contract. Default
is 1; unknown settings are rejected. Enabled adapters expose a readonly,
nonenumerable contractVersion capability. The broker advertises
configureReactive(available, 1, contractVersion), selecting 2 only when its
provider explicitly exposes 2. Native child environment filtering still removes
all dedicated observer configuration. No credentials, ledger limits or provider
activation defaults change. Browser/session/core V2 support must be installed
before opting in; a request/adapter version mismatch fails before reservation
or network, rather than falling back silently.

The observation-window container stays version 1. Its request is a strict union
of V1 and V2: V2 adds mandatory semanticSnapshot with orientation, expression and
handMotion nullable safe counters, and mandatory nonnull handIdentity history
revision. Identity is not perception confidence. All fields are compared between
the authorized outer request and frozen provider input. Critical identity,
presence, intent, source, track and permission checks cannot be waived.

V2 decisions require unique prerequisites drawn from orientation, expression and
hand_motion. Selected unknown captured axes are rejected, including for observe;
[] permits a context-independent symbolic phrase only when appropriate. The
prompt asks for explicit dependencies or observe when that is not appropriate;
this does not establish actual model-choice quality. The model does not receive
an execution lease field. validUntil remains the request's admission deadline.
Only the host may derive execution authority from accepted compiled duration
plus 100 ms, bounded to 1,100 ms by the coordinated core.

V2 express bodies have exactly one sequence step containing one parallel group
of one to three morph/flow/shapeQuality leaves. Each leaf duration is 200–1,000
ms. Assemblies, live configuration, coordinates, extra leaf fields and model
lease fields are rejected. Parallel composition has compiled duration at most
1,000 ms; the core independently validates these limits before admission.

The sent strict schema closes every object and requires all fields, following
[OpenAI's structured-output requirements](https://developers.openai.com/api/docs/guides/structured-outputs).
It omits uniqueItems; local parsing and the core enforce prerequisite uniqueness.
No live API compatibility or semantic-quality test is claimed. Existing receipt
prompt/request hashes bind the selected instructions, schema and input version.

## Codex-only demo and local cue fallback

Native Codex conversation and expression tools use the existing signed-in host;
local cue responses do not require the separate Responses provider or an API key.
The resting body follows valid tracked face position and, when optional local
hand tracking is enabled before camera start, bounded primary-wrist position.
These are smoothed geometric reflexes, not semantic scene understanding, emotion
inference or gesture-to-expression presets. Missing/stale/lost inputs fade toward
neutral and release their local channels, leaving idle motion free. Motion-off remains authoritative, and default cue writes yield to an
explicit user creation; authored controls and arbitrary RGB remain available.

Live initializes a crisp resting baseline (brightness 0.95, point size 2.2,
dispersion 0). The shared legacy Scheduler defaults are unchanged; authored state
and playground styles can still replace that baseline. There is no flashing or
emotion-to-color mapping. A controlled headless SwiftShader style ablation showed
more nonbackground pixel energy with this profile; that is not a human enjoyment,
recognition, real-camera or physical-display measurement.

A signed-in Codex app-server is not automatically a data-only observer. In the
examined installed CLI 0.167.0-alpha.4, generated ThreadStartParams/TurnStartParams
provide ephemeral threads, instructions, sandbox policy and final outputSchema,
but no verified global zero-tools boundary. Empty dynamic tools, read-only mode
and a JSON response schema do not establish that inherited tools, skills or
context sources are absent. No Native observer is auto-enabled on that basis,
no camera events are injected into the coding thread, and no auth material is
copied or exported to the Responses endpoint. A supported enforceable restriction
and an authenticated host test are still needed for that adapter; an API key is
not required merely to use the Codex-plus-local-reflex demo.

Reproduce without a model or webcam: `npm ci`, install Chromium with
`npx playwright install chromium`, then run
`npx vitest run tests/local-reflex-demo.test.mjs tests/live-reactive-body.test.ts`.
The fixture injects synthetic hand observations into the actual Live page and
reads WebGL aggregates, never camera pixels. Unit tests check loss/ownership and
an authored dimmer style. This uses existing MIT Fisch code and locked Vite,
Playwright and Three.js dependencies; no new framework, dataset, model or package.

## Bounded geometric attention during work

Live can briefly move the declared resting body's pupils toward a fresh, salient
face/primary-wrist position while ordinary Codex work activity continues. This is
a local geometric-attention policy, not semantic camera understanding or emotion
recognition. No extra API key, model, STT/TTS, framework or dataset is introduced.
Arbitrary agent-authored geometry, RGB and control rules remain available.

At least two distinct measurements of the same target over 80 ms debounce a
candidate (they do not establish a stationary position); a 0.12
normalized displacement from the last attended anchor is novel. Centered input
needs no glance. Reported face tracking-stability quality and a 700 ms freshness bound reject
unknown/stale cues. Hand tracking uses the typed tracked state, primary track and
finite wrist coordinates; handedness confidence is not tracking confidence and is
not used as such. One episode lasts 850 ms during working/replying or 1100 ms otherwise,
with bounded entry/release envelopes and a six-second cooldown. New compatible
frames update the target instead of cancelling it. Quiet/cooldown inputs update
anchors without queueing reactions for later. Default pupils rest at the eye centers; during an episode they can travel up to
0.12 horizontally / 0.075 vertically from those centers. Working eyes open and
ambient blinking attenuates with the same envelope, leaving the mouth/activity
state intact. The canonical eye/pupil bounds have a conservative ellipse test;
these numbers are anatomy-specific, never applied to agent-authored shapes.
Reduced-motion strength remains 8%; user controls remain the later layer.

Epoch, Native intent, explicit user lease/creation, source loss/change, motion-off
and disposal revoke/suppress this layer before rendering. Resume rebases to the
latest cue, so movement seen only while motion was off is not replayed. Cached pre-reset input
cannot re-arm it. Epoch and source sequence provide ordering; capture timestamps
only identify distinct measurements and map reported observation age into a monotonic deadline.
The camera adapter now retains the host callback's frame-availability time before
waiting for a worker/bitmap/inference, plus a separate bitmap-request time and the
associated callback mediaTime. Matching frame ID and camera generation fence
results; duplicate/retired replies cannot consume a newer pending frame. Camera
observations use availability time as capturedAt; non-camera fixtures without
sourceFrame keep their explicit caller-supplied time. Invalid/future/regressing
source times or results older than 1500 ms cannot update the observation/event
store. The 700 ms attention limit therefore includes host wait/inference age.
Neither time is a sensor timestamp, and callback mediaTime is not asserted to be
the exact bitmap PTS. Physical frame age and capture-to-display latency remain
unverified. Intent/rebase and explicit epoch reset also fence delayed observations
acquired before or at the barrier, even before any observation has arrived. Clock
rewind fails closed until reset. Agent controls remain the later compositor
layer; an arbitrary part named like an eye is not recognized as anatomy.

The memory-only visualAttention metric retains at most 32 transition records with
epoch/intent generation, evidence-start/latest source sequences, target and reason.
Lease expiry is logical timing, not proof of visibility. Run
`npx vitest run tests/visual-attention.test.ts tests/live-reactive-body.test.ts tests/local-reflex-demo.test.mjs tests/gaze-render.test.mjs`
with the repository's locked dependencies/Chromium to reproduce virtual replay
(including 20 virtual minutes), ownership/epoch tests and actual WebGL pupil motion
with synthetic hand input and simulated Native work/intent callbacks. Replay does
not call perception or a model; no real camera/mic is used. Identical virtual-clock
input yields identical local trajectories in the same runtime. Human naturalness,
physical-camera quality and actual Codex task acceptance remain separate gates.

The default anatomy centers pupils at x=-0.6/0.93 so both move in the cue direction
from rest, rather than correcting a pre-existing rightward bias during the glance.
Old authored/saved assemblies retain their geometry and are not silently converted
into the new canonical resting face. Entry/release and reduced-motion sign tests
cover each pupil relative to neutral, alongside endpoint-range checks.

The gaze render test compares before/after at matching working/blink phases and
body tilt. It isolates already-rendered particle groups with the camera/fitting
held fixed, then measures pupil pixel centroids relative to their eye outlines.
The direction-range metric is an engineering proxy; screenshot review and human
naturalness are separate, not established by larger pixel displacement. Optional
`FISCH_GAZE_EVIDENCE=/absolute/directory` writes synthetic PNGs/metrics outside Git.
