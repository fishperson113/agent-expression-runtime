# Auditable original Laya evidence

These files deliberately publish synthetic validation records so another reviewer
can recompute the confusion matrices. No personal media, user conversation,
credentials or model weights are included. The fixture content is MIT; original
Laya weights/source retain Apache-2.0. This is not real-camera or human validation.

- [Original 104 predictions](evidence/classifier-laya/original.jsonl)
- [16 paired predictions](evidence/classifier-laya/paired.jsonl)
- [32 reversed-option predictions](evidence/classifier-laya/reversed-options.jsonl)
- [Full metrics and confusion matrices](evidence/classifier-laya/metrics.json)
- [Independent overlap audit](evidence/classifier-laya/overlap-audit.json)
- [Model/data/output hashes](evidence/classifier-laya/manifest.json)
- [Nine actual product-factory classifications](evidence/classifier-laya/product-actual.jsonl)
- [Product-factory outcome and limits](evidence/classifier-laya/product-summary.json)

**Correction:** eight original holdout rows exactly repeat train features for the
structured-only logistic baseline, although the full states differ in notes.
The original 26/32 baseline score is not generalization evidence. Original
files are preserved. The separately named `holdout_nonoverlap_posthoc` cohort
has 24 rows/six families: logistic 18/24, always-observe 12/24 and Laya 6/24.
It is a post-hoc diagnostic, not a new untouched test. Seven paired feature
vectors also repeat training examples; paired probes are not independent tests.

The optional runner/evaluator and frozen fixtures are documented in
[the classifier experiment](classifier-experiment.md). Concatenate the original
and paired fixture files, and concatenate their prediction files, then run its
evaluator. Scores are the actual model categorical output normalized only for
upstream four-decimal rounding. `raw` preserves the original result. Macro F1
uses the first acceptable label and all five classes; acceptable accuracy permits
the fixture's declared alternative labels. Must-abstain unsafe reactions are
reported separately from ordinary-negative false positives.

Laya failed utility: fixed gating abstained on every original holdout row.
The product trial made nine additional actual CPU forwards, including one
late-abort case, but produced zero rendered actions and zero semantic dispatches.
It exercised the optional factory at source `3e5b0bb`; subsequent clock/callback
hardening is tested separately and must not be retroactively attributed to that
run. There was no actual hosted semantic provider. These records support audit
of the experiment, not a recommendation to enable this classifier.
