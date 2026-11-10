# Local GLiNER decision trial

This is a second actual local classifier experiment, not a proposed model or
an enabled production default. It classifies structured synthetic hand, face
and context state into five abstract categories with abstention. It does not
inspect images, infer emotions or choose fixed gesture/color effects.

## Model and execution

[Fastino GLiNER2.5-Decide](https://huggingface.co/fastino/GLiNER2.5-Decide),
revision `9d1bfb848cd16d93ee56ccbc59cd92bf0f284d90`, is Apache-2.0;
its Microsoft DeBERTa-v3-large backbone is MIT. Preserve both upstream notices.
Actual weights are 1,945,828,140 bytes, SHA-256
`40a5a23ff860dc3dff426cecd1048cacdd29c648c96db209dad818e9686dc997`.
This loaded checkpoint has 486,444,053 parameters; do not substitute the model
card's different parameter count. SDK 2.1.0 dispatches this English checkpoint
to its span extractor despite the 2.5 name.

The public API exposes top-one confidence. The runner passively records the
single-label softmax returned by the unchanged SDK implementation, asserts its
argmax/score equal the public result, then restores the original method. It
never fabricates a five-score vector or substitutes multi-label sigmoid scores.
This experimental instrumentation depends on an exact checked runtime source
hash, alongside pinned SDK and model assets. Future incompatible versions fail.
Scores and the fixed 0.7 top-score/0.15 margin gate are not calibration claims.

Actual CPU execution used PyTorch 2.7.1+cpu, four threads, no hosted inference:
120 original/paired fixtures, 26 additional challenges, three simple operational
controls, eight product-factory requests, and one portable-worker smoke request:
**158 actual local forwards**. Original inputs, task and runner were frozen
before predictions. The original 120 and fresh 26 runs had no SDK/capture errors.
The model-type warning `gliner2` versus `extractor` is retained; strict loading
had zero missing/unexpected keys. All three billing/technical/sales controls
classified correctly. These controls establish basic runtime operation, not
Fisch utility or universal model ability.

## Outcome and limits

| Cohort | Always observe | Structured logistic, raw | GLiNER raw | GLiNER fixed gate |
|---|---:|---:|---:|---:|
| Original mixed probe, 32 rows | 16/32 | 26/32 | 12/32 | 12/32 |
| Nonoverlap post-hoc diagnostic, 24 rows | 12/24 | 18/24 | 8/24 | 8/24 |
| Fresh feature-isolated challenge, 26 rows | 6/26 | 10/26 | 3/26 | 9/26 |

The original probe includes eight exact training-feature repeats for the
structured baseline. Its scores are not generalization evidence. The 24-row
subset is post hoc, not newly untouched. The additional 26 rows were frozen
before their model predictions and have no exact baseline training-feature
duplicates, but were authored after seeing Laya failures and are not externally
blinded or representative human data. All labels encode an engineer's policy.

On the 24-row diagnostic, GLiNER proposes reactions on eight of 12 ordinary
negatives, even with the fixed gate. On 12 original must-abstain OOD cases,
raw GLiNER proposes 12 reactions; fixed gating still proposes three. The fresh
challenge's gated ordinary-negative FPR is 2/6 and unsafe must-abstain reactions
are 2/9. This configuration fails useful autonomous classification. It remains
off by default. Descriptive labels differ from initial Laya's bare names;
comparison is of complete configurations, not weights alone. Jev was not used.

The actual product trial used the bounded local process client and optional
provider factory, not replayed scores. One positive gate result exercised a
controlled fake semantic request and one fixture-budget reservation. Intent
revocation after inference made zero new reservations/HTTP calls; caller abort
retained the orphan transport until its valid reply, then the worker was reused.
Host-denied candidates made no local inference. There were no actual hosted
calls, rendered actions or physical camera tests. A repository-portable worker
also completed actual inference through the same client.

## Reproduce

Install CPU PyTorch 2.7.1 in an isolated Python 3.12 environment, then
`experiments/classifier/requirements-gliner.txt`. Download only the pinned
checkpoint's `config.json`, `encoder_config/config.json`, tokenizer files and
`model.safetensors` into a dedicated model directory. The runner verifies all
asset hashes before offline loading and refuses an existing output directory.
No `trust_remote_code`, credentials or automatic remote inference are needed.

```sh
python experiments/classifier/gliner.py --model-dir /path/to/pinned-model \
  --dataset experiments/classifier/dataset.jsonl experiments/classifier/counterfactuals.jsonl \
  --prompt experiments/classifier/prompt-policy.txt --output-dir /tmp/gliner-original
```

Use the shared evaluator with `--model-label gliner`; concatenate the original
and paired datasets for its input. Its baseline fits only original train rows.
`serve-gliner.py --model-dir ... --prompt ...` provides the bounded client's
JSONL worker protocol. The caller supplies trustworthy preprocessing, current
host authorization and the request's actual clock domain. Hand measurement
quality must remain unknown when unavailable; handedness confidence is not a
substitute. Production preprocessing/UI selection and human relevance remain
separate gates. Full synthetic predictions and matrices accompany this record.
