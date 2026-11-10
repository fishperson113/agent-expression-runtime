# Local classifier shadow boundary

`integrations/classifier-shadow.mjs` is an experimental adapter for a local
classifier's abstract recommendation. It is not a live provider, controller,
expression generator or default setting. It performs no network/model call and
has no DSL translation. An `attend` recommendation does not prove that Fisch
rendered an appropriate reaction.

Bind a validated frozen reactive window before inference. The adapter retains
host-owned request/session/epoch, deadline, intent revision and read sets; the
model supplies only this JSON protocol:

```json
{"schemaVersion":1,"label":"observe","scores":{"observe":0.9,"attend":0.025,"acknowledge":0.025,"playful":0.025,"abstain":0.025}}
```

All five scores are required, finite probabilities in [0,1], summing to one
within 0.00001. The declared label must have a maximal score. Independent binary
answers or logits require an explicit separately reported conversion; they must
not silently masquerade as a categorical distribution. For Laya outputs rounded to four decimal places, preserve the raw output in
the experiment evidence, divide each rounded score by their positive sum, and
report that conversion as rounding normalization. This does not calibrate the
model. Model identity/revision is supplied by the host, not inferred from output.

The caller freezes `minConfidence` and `minMargin` using development data before
holdout evaluation. Either failed cutoff changes the recommendation to abstain.
These cutoffs are heuristics, not evidence that model probabilities are
calibrated. An explicit model abstain remains distinguishable in the reason.

`now()` must use the same clock domain and origin as the bound request deadline.
Do not compare a browser-uptime deadline to Node performance time or wall time.
A thrown, nonfinite or negative clock fails closed. The adapter requires an
explicit clock and does not invent a cross-process clock mapping.

`isCurrent(binding)` must synchronously return exactly true to retain a shadow
recommendation. The caller supplies its existing authority check; this adapter
does not implement a second causal state machine. Any exception, expired host
clock, invalid prediction or repeated callback fails closed. Frame movement
alone is not checked as a stale condition. Tests with an injected host callback
test this boundary, not full integration with the actual reactive session.

Retained bindings include completed IDs, have configurable capacity up to 256,
and reject overload instead of silently evicting dedup state. `clear()` disposes
all bindings and invalidates old object tokens; call it at experiment/session
end. Reusing an identical request ID after clearing is caller-owned behavior,
not a guarantee of durable exactly-once execution. No output here executes an
action. Keep actual reactive admission/ownership validation before any future
explicitly designed expression translation.
