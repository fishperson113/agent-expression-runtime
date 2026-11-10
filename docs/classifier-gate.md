# Experimental local classifier gate

`createLiveReactiveProvider(env, { classifier })` optionally puts a local
classifier before the existing semantic observer. This is a dependency-injected
integration; it adds no CLI flags, credentials, automatic download or default
rollout. Existing provider configuration and an approved cumulative budget are
still required. Missing approval cannot be bypassed by enabling the gate.

The classifier option has `modelId`, `modelRevision`, `minConfidence`,
`minMargin`, `classify(window, signal)`, optional monotonic `now`, and optional
`onClassification(metadata)`. Its input is the validated frozen observation
window with natural-language summaries removed. It returns a JSON string in
the strict five-score [classifier protocol](classifier-shadow.md).

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
