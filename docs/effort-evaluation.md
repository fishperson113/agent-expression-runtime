# Effort perception remains an empirical question

Run `npm run evaluate` to open an automatically paired body and a blind A/B evaluator in the terminal. It needs the runtime prerequisites and a browser, but no Codex login or model call. Watch both clips and answer `a`, `b` or `u` (unsure). `q` saves partial results and stops.

The evaluator counterbalances and shuffles 20 comparisons per axis using a recorded seed. Each pair changes only the effort value, keeps the same 1200ms duration and resets posture, shape, dispersion and flow between clips. Reduced motion is disabled during evaluation. Flow asks which clip looks freer; time asks which begins moving sooner. Time currently changes the speed curve, not total duration. Flow currently adds up to 0.03 world units of jitter per axis; this is not presumed perceptually sufficient.

Results stay in `.runtime/effort-evaluation.json`, without credentials or personal identifiers. Unsure judgments count in the denominator. Fewer than 20 judgments per axis are marked unassessed. A Wilson 95% lower bound above chance is reported only as detected in that observer session. Automated tests use synthetic answers to verify scoring and never count as human evidence.

No human perceptual result has been collected by this change. Neither effort parameter is considered perceptually accepted. Repeat on the actual target desktop and portrait/mobile displays with multiple independent observers before selecting transfer functions or claiming general recognizability. Do not infer emotion labels from these comparisons.
