# Local classifier experiment

This optional offline experiment evaluates original Laya on structured synthetic
hand, face and context features. It does not process images, infer emotions,
author effects, or enable a production observer. The abstract five-way result
is a proposal: observe, attend, acknowledge, playful, or abstain.

## Sources and permissions

The checkpoint is [convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya),
revision `55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`, under Apache-2.0.
Its [original SDK](https://github.com/NandhaKishorM/laya) runs on Linux/Windows;
the MLX port is not required. The ModernBERT-large base is also Apache-2.0.
The model card warns that the base typed-decision model can be inaccurate and
overconfident. Score thresholds below are experimental, not calibration.

Only synthetic observations authored for this experiment are used. Their MIT
license, hashes, split design and limitations are in the dataset manifests.
No credentials, personal images or hosted inference are required. Jev was not
called because the hosted service requires credentials and may incur charges.

## Reproduce

Create an isolated Python 3.12 environment. Install CPU PyTorch 2.7.1 from its
official CPU index, then `experiments/classifier/requirements.txt`. The experiment
used the checkpoint's inspected standalone `RLAgent`, not Vega, Router, or the
newest SDK's extra dependencies.

Download the following files from the pinned Hugging Face revision into a local
model directory, retaining upstream license/model notices: `rl_agent_api.py`,
`rl_common.py`, `rl_agent_config.json`, `encoder/config.json`,
`tokenizer/tokenizer.json`, `tokenizer/tokenizer_config.json`, and
`model.safetensors`. The runner checks exact SHA-256 values before importing the
two upstream Python modules. Inspect those files before running downloaded code.
There is no `trust_remote_code`, remote inference, or automatic model download
in the runner. Keep weights and generated results outside Git.

```sh
python experiments/classifier/run.py --model-dir /path/to/pinned-model \
  --dataset experiments/classifier/dataset.jsonl \
  --prompt experiments/classifier/prompt-policy.txt --output-dir /tmp/laya-original
python experiments/classifier/run.py --model-dir /path/to/pinned-model \
  --dataset experiments/classifier/counterfactuals.jsonl \
  --prompt experiments/classifier/prompt-policy.txt --output-dir /tmp/laya-pairs
```

Each output directory must be new. The runner records model/source hashes,
versions, prompt, token preflight and raw scores. No state or question may be
silently truncated. Upstream four-decimal categorical scores are preserved,
then normalized only for rounding before entering the strict shadow adapter.

For the comparison, concatenate the two dataset JSONL files into a fresh file,
and concatenate the two prediction JSONL files in the same way. Run:

```sh
python experiments/classifier/evaluate.py /tmp/all-dataset.jsonl \
  /tmp/all-predictions.jsonl /tmp/classifier-results.json
```

The logistic baseline fits only 40 train rows, with structured fields and no
natural-language note. No weights, prompt or thresholds are fitted on holdout
or paired probes. The fixed score gate uses top score 0.7 and margin 0.15 for
both models. Always-observe is also reported. Abstention on positive examples
reduces reaction recall; reactions on must-abstain examples are reported
separately from ordinary negative false positives.

## Evaluation limits

There are 104 original rows, split by 26 scenario families, plus eight exact
counterfactual pairs. Numeric variants are correlated: 32 holdout rows represent
eight families, not 32 independent people. Labels encode an engineer-authored
interaction policy, not measured human preferences or gesture ground truth.
Face availability is explicit; an unavailable face is not observed absence.
Synthetic confidence is measurement quality, never MediaPipe handedness score.
Recent-response age and source health are experimental context extensions,
not claims about currently transported production fields.

Actual scores are replayed through the [shadow adapter](classifier-shadow.md).
That boundary does not generate DSL or grant control ownership. Callback-based
revocation tests are protocol tests, separate from the existing causal host
regressions. This experiment does not certify rendering, camera accuracy,
naturalness, retention or a replacement for the current semantic agent.

## Measured result, 2026-11-10

Original Laya actually ran on Linux CPU with the pinned 842,609,210-byte weights.
There were 152 offline forwards: 104 original fixtures, 16 exact paired probes,
and 32 option-order probes. Nine further forwards used a persistent local Laya
worker through the optional product provider factory: **161 actual local Laya
forwards in total, zero hosted model calls**. No input labels, prompt or score
thresholds were changed after predictions. No Laya training was performed.

| Arm, original holdout | Acceptable label | Reaction recall | Negative false positives | Coverage |
|---|---:|---:|---:|---:|
| Always observe | 16/32 | 0/12 | 0/16 | 32/32 |
| Structured logistic, raw | 26/32 | 12/12 | 6/16 | 28/32 |
| Structured logistic, fixed gate | 15/32 | 6/12 | 3/16 | 10/32 |
| Original Laya, raw | 14/32 | 4/12 | 4/16 | 18/32 |
| Original Laya, fixed gate | 8/32 | 0/12 | 0/16 | 0/32 |

On 12 must-abstain OOD rows, raw Laya correctly abstained on five but proposed
an unsafe abstract reaction on five. Its fixed gate abstained on all 12, while
also suppressing every holdout reaction opportunity. This is failed utility,
not a successful classifier rollout. Raw logistic also produced unsafe OOD
reactions on four of 12; neither model is accepted for autonomous enablement.

Reversing only the option order changed seven of 32 Laya holdout argmax labels.
Three of eight exact pairs had the expected change/invariance relation, but
zero pairs had both labels acceptable. One turn counterfactual moved in the
wrong direction: idle was classified observe, working was classified attend.
These failures are retained rather than repaired by tuning on those probes.

The product trial used actual inference on projected typed V2 windows through
`createLiveReactiveProvider(..., { classifier })`. All eight normal cases were
gated to observe/action-null, making zero downstream semantic requests and
zero fixture-ledger reservations. A ninth request was rejected after a user
abort following actual inference. The local worker exited cleanly. Downstream
positive dispatch is covered by controlled integration tests, not by a claimed
successful expressive Laya example. There were no rendered actions.

The projection explicitly left hand measurement quality unknown rather than
using handedness confidence, and supplied response age as synthetic trusted
host context. Production context extraction and the optional CLI/UI selection
are separate integration work; this experiment does not silently enable either.
GLiNER2.5-Decide was researched as another Apache-2.0 local candidate but was
not downloaded or executed. Jev was not executed. The immediate recommendation
is to retain the opt-in gate and failed evidence, and improve/re-evaluate a
candidate on independent data before attempting a live expressive rollout.
