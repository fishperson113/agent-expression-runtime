# Experimental local classifier gate

`createLiveReactiveProvider(env, { classifier })` optionally puts a local
classifier before the existing semantic observer. This is a dependency-injected
integration; it adds no CLI flags, credentials, automatic download or default
rollout. Existing provider configuration and an approved cumulative budget are
still required. Missing approval cannot be bypassed by enabling the gate.

The classifier option has `modelId`, `modelRevision`, `minConfidence`,
`minMargin`, `classify(window, signal)`, required monotonic `now`, required
`isCurrent(request)`, and optional
`onClassification(metadata)`. Its input is the validated frozen observation
window with natural-language summaries removed. It returns a JSON string in
the strict five-score [classifier protocol](classifier-shadow.md).

`now()` must use the same clock domain and origin as `window.request.deadline`.
Browser and Node performance clocks have different origins; passing Node's
`performance.now` for a browser-origin deadline is invalid without a verified
mapping. The gate deliberately provides no default clock or inferred mapping.
The caller owns that mapping; the causal host remains the admission authority.

`isCurrent` is a trusted host freshness check returning `true` or a promise of
`true` only while intent, source/permission, epoch and required tracking remain
valid. It is checked before classification, after classification and directly
before semantic dispatch. Missing checks, false results and exceptions fail
closed. A browser bridge needs an authoritative read-only validation API;
cached Node revisions do not establish browser freshness. The gate does not
reuse the host's non-idempotent initial authorization operation.

The broker also aborts the active observer when accepting native user intent,
before awaiting the browser revocation barrier. It retains transport ownership
until settlement; abort is not evidence that a remote provider stopped billing.
Cross-process freshness checks cannot make a browser change and network send
atomic. Abort checks and final causal-host validation remain mandatory.

Observe, abstain, low confidence, invalid output and local classifier errors
produce a host-owned observe decision with no action and no semantic model
request. Positive abstract categories delegate to the existing observer,
which still reserves budget, chooses its own bounded expression and passes
the same decision validation and causal host. No category maps to a fixed
effect. Metadata contains only request/model identity, abstract label and reason.
Summary fields are restored as empty strings solely for the provider's second
schema validation; original summaries never reenter inference.

One classifier/semantic operation may be active. Up to 256 request keys are
retained for dedup; capacity exhaustion rejects rather than silently replaying.
Aborts and monotonic deadlines are checked around awaited work and before
semantic dispatch. Clock failures fail closed. Provider cancellation and actual
camera/intent/track validation remain the responsibility of the existing broker
and causal host; this adapter does not mint ownership or extend leases.

The caller owns the local model runtime and its preprocessing. In particular,
unavailable face data must not be represented as measured absence, and hand
handedness confidence must not be renamed gesture confidence. Score thresholds
are policy controls, not a claim of probability calibration or gesture accuracy.
The unit tests use injected classifiers and fake HTTP. Real-model utility and
rendered behavior require separate evidence.
