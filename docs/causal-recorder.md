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

Provider receipts are optional data-only metadata: request/config/prompt/response
hashes, fixed transport outcome, Node monotonic duration and reported token usage
(or `unknown`). They contain no model name, endpoint, credential, prompt, response
body or absolute Node timestamp. A receipt joins an already-recorded request;
missing parents remain explicit incomplete evidence.

The browser binds receipt capture to its active run and lifecycle generation at
request collection and the existing dispatch authorization. Starting, stopping,
clearing, expiry or disposal invalidates old capture authority. The Node broker
queues at most eight strict receipts and flushes them through its existing poll;
there is no additional browser call competing with user cancellation. Receipts
from an old or inactive capture are discarded rather than backfilled into a new
opt-in run. Late transport metadata can be recorded after action revocation, but
cannot apply a decision, revive a lease or forward anything to native chat.

## Version-two semantic and temporal metadata

The capture envelope remains `schemaVersion:1`; each stored reactive request keeps
its explicit request `schemaVersion:1` or `schemaVersion:2`. Version one retains
its legacy strict fields. Version two requires `presenceRevision` and the exact
`semanticSnapshot` axes `orientation`, `expression`, `handMotion` and `handIdentity`.
Orientation, expression and hand motion are nonnegative safe integers or explicit
null (unknown), never an implicitly substituted zero. Hand identity is always a
required nonnull safe integer tracking-history revision, even when no hand is
currently available; it cannot be omitted or treated as a wildcard. Unknown versions,
missing axes and extra fields fail closed. This history counter does not identify
a person or establish biometric identity.

Only trusted, schema-validated host outcome/ownership metadata may supply
`decisionVersion:2` and the unique prerequisite list: `orientation`, `expression`
and/or `hand_motion`. An empty list records an explicitly generic dependency
choice; it is not permission to waive presence, intent, epoch, track membership,
source validity or hand identity. Invalid request/output paths must not peek at
raw provider data to fabricate these fields. The recorder accepts no raw action,
body, provider output or natural-language explanation.

Version one retains its existing coupled validity behavior; separate execution
expiry is version-two-only metadata. For version two, admission and execution are
distinct temporal phases. The browser's five-second
request deadline and decision `validUntil` bound admission. After successful
admission, the host derives `executionValidUntil` from its own monotonic admit
clock plus validated program duration and at most 100 ms completion allowance,
with a maximum 1,100 ms execution lease. The model does not choose this timestamp.
Only accepted outcomes can record that execution timestamp; failed admission or
observe does not acquire execution authority. Execution validity may extend past
the admission cutoff without reopening admission or reviving a revoked owner.

Manifest clock labels distinguish request deadline, admission `validUntil` and
host-derived `executionValidUntil`; all use the browser host monotonic clock.
Their values must not be converted using observation wall timestamps or Node
provider-duration deltas. Recorder projection validates metadata shape and finite
values, while the trusted host enforces the duration arithmetic and prerequisites
on each execution tick. A recorder append is neither authorization nor proof of
execution. Root wiring must pass trusted host results rather than raw-output fields.

Version-two behavior requires explicit integration opt-in. The coordinated
provider selects it with `FISCH_REACTIVE_CONTRACT_VERSION=2`; backend/model/endpoint
and the existing approved budget remain independently required. This recorder
does not select that switch or a provider, turn on the observer, alter the budget
or enable a camera. Prefix quotas, 60-second default TTL, missing-parent detection and the ban
on pre-consent backfill remain unchanged for both request versions. These records
remain bounded debugging evidence, not an M5, real-model or naturalness claim.
