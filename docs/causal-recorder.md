# Opt-in causal evidence recorder

`CausalRecorder` is a pure in-memory store. It starts off, never calls a provider,
and has no filesystem, browser download or automatic persistence behavior. Core
capture alone does not enable a UI or attach session/render hooks.

Construct with injected `now`, `wallNow` and `epoch` functions. Explicit
`start({runId, mode, sourceSha?, seed?, configHash?})` starts a new buffer; mode is
`synthetic` or `live-structured`. Unknown metadata fields are rejected. Defaults
are 2,048 records, 8 MiB total, 32 KiB per record and 60 seconds; configurable
limits can only decrease record/byte caps, while TTL has a hard 30-minute maximum.
Depth and node limits also apply before payload projection.

`append(kind, payload)` returns false rather than throwing for rejected payloads
or failed callbacks. Strict allowlists accept typed observation, event, request,
authorization, decision metadata, revocation, execution and frame-proxy records.
Observation validation precedes removing `summary`; raw decision bodies, arbitrary
error text, transcripts, prompts, media, credentials and unknown fields are not
accepted payloads. Geometric landmarks remain sensitive structured data: opt-in
capture does not make them anonymous or authorize sharing.

Each exported record has a recorder sequence, epoch, `recordedAtMono` and
`recordedAtWall`. Requests reference observations/events by source session and
sequence. Bounded parent indexes detect missing observations/events/requests.
Starting mid-turn never backfills pre-consent inputs: safe metadata can be retained
but marks the manifest `missing_parent`/incomplete without counting it as a dropped
record. This limited graph check does not validate every possible dependency.
Execution may precede its terminal decision record after synchronous admission;
only its request must already be known. An active or stopped capture may still
contain an unresolved request. `incomplete` reports recorder loss/parent gaps,
not generic graph closure or a guarantee that every request has a terminal outcome. Observation capture/event timestamps retain their existing wall-ms
meaning; request deadlines and execution timestamps remain host-monotonic ms.
The manifest records clock anchors and those distinct meanings. It does not
invent a media PTS mapping, physical capture time or cross-process clock sync.

Quota stops preserve the recorded prefix, disable further capture, and mark the
manifest incomplete with a fixed reason/drop count. Invalid payloads are dropped
and marked incomplete while capture can continue. No invalid raw payload or
exception message is retained. Recorder callbacks must not be used as a required
execution acknowledgment; the optional caller-side sink must contain exceptions
and continue perception/dispatch independently.

`stop()` stops capture without immediately discarding the prefix. TTL still bounds
its retention: `append`, `tick`, `status` and `snapshot` check expiration even after
stop. At TTL, retained records are cleared and an expired/incomplete manifest
remains. Invalid/backward clocks clear retained records and mark `clock_invalid`.
Injected callbacks that throw cannot escape append/status/snapshot. `clear()`
removes both records and manifest. No timer runs inside core; the integrating host
must call `tick()` regularly and clear data on teardown. This is an in-memory TTL,
not a durable filesystem deletion or privacy-retention certification.

`status()` clones only the small manifest for UI polling. `snapshot()` returns an
independent version-1 data-only object with manifest and records; mutation of that
copy cannot alter the store. A future browser export must remain a separate manual,
bounded action, with no automatic upload. Missing optional source/config hashes
remain unknown; the recorder does not claim a reproducible run without them.

Execution and frame records are lifecycle/hash proxies. This format supplies
partial causal debugging; it is not a generic field-level read-set, full event
envelope, deterministic controller replay, particle trajectory, perception-accuracy
measurement or human-naturalness evaluation. No remote agent model request is
needed to exercise it.
