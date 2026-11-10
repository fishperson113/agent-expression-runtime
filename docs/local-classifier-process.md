# Optional local classifier process

`createLocalClassifier` in `integrations/local-classifier-process.mjs` owns one
explicitly configured Python worker. It does not download models, create
credentials, open a server, alter UI/CLI defaults or provide an OS sandbox.
The worker and its dependencies are trusted local code selected by the caller;
model/source hash and license verification remain the worker's responsibility.

Required options are absolute `pythonExecutable`, `workerPath`, `modelDir`,
`promptPath`, `expectedModelId`, `expectedRevision`, and a synchronous
`projectWindow(window)` returning JSON-safe task features. Optional relative
transport timeouts are `startupTimeoutMs` (default 120000) and
`requestTimeoutMs` (default 30000), each at most 300000 milliseconds.

Await `client.ready` before `client.classify(window, signal)`. Calls before
readiness, concurrent calls and invalid or oversized projections reject without
queuing. A successful classification returns the strict five-score JSON string
accepted by the optional provider gate. Pass the gate a caller-owned request
clock and authoritative `isCurrent` check separately; process transport timeouts
are relative Node timers, not comparisons against browser request deadlines.

The worker is spawned without a shell using these arguments:
`-u workerPath --model-dir modelDir --prompt promptPath`. It must emit one line
`{"ready":true,"modelId":"...","modelRevision":"..."}`. The ready object
may also contain a finite nonnegative `loadMs` field. Requests are
`{"id":"host-generated-unique-id","state":...}`. Replies contain matching
`id`, `label` and normalized `scores`, optionally `raw`, `elapsedMs`, `modelId`
and `modelRevision`; `{ "id":"...", "error":"..." }` is a settled failure.
Raw scores/logs are not forwarded by this client. Stderr is discarded to avoid
copying private worker diagnostics into product logs.

Input is bounded to 16 KiB and stdout to 64 KiB before newline accumulation.
Startup identity mismatch, malformed output, unknown IDs, invalid scores,
startup/request timeout or child failure closes the client and kills only its
owned worker. There is no automatic restart or request replay. Caller abort
rejects promptly but retains the actual transport slot until the matching reply
or child termination; another request cannot incur parallel work in that gap.
`await client.close()` waits for the owned process to close.

The child environment contains only executable/platform paths, temporary-path
and locale variables plus offline/telemetry-off Python/model settings. API keys,
Fisch settings, auth paths and `PYTHONPATH` are not inherited. This reduces
accidental credential access; trusted worker code still has normal filesystem
and OS permissions. This is not proof of a model sandbox or network isolation.

Protocol tests run a real tiny Python fixture process without model weights.
They establish framing, lifecycle and bounds, not model utility or accuracy.
