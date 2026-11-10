# Agent-authored forms and composition

Fisch is an expression engine, not a fixed face or an emotion-tag player. The
external agent can choose standalone geometry, change the whole body, or combine
components from its conversation/task context. No runtime phrase/gesture-to-shape
mapping is added. RGB, arrangement and bounded motion remain agent choices.

Live MCP exposes `aer://live/v1.restingFace.parts` through resources/read when
FISCH_LIVE=1. To retain that optional avatar and add a component, copy the full
parts array and add uniquely identified parts within the 24-part limit.
`assemble.parts` specifies the whole target geometry; policy append queues time,
not spatial geometry. For a remix, send a complete authored snapshot with stable
IDs for components being retained. Include desired live controls in the new
configuration if they must persist: configuration replacement is not a merge.
`return_to_face` deliberately removes extra parts; it is not mandatory after
illustration. Saved playground geometry and renderer summary have different
contracts; neither is an image or proof of meaning.

A complete unchanged canonical face component retains its local mouth/blink/fin
presence inside a larger scene, beneath authored controls. Detection compares all
canonical geometry and unique IDs, never names alone. Modified/partial faces and
standalone shapes receive no inferred anatomy. Exact whole-face detection still
governs resting ownership; a compound scene remains agent/user-owned, so local
hand follow, automatic gaze and reactive model work cannot reclaim it. Motion-off
and stop remain authoritative. This adds no emotion preset or new tool/API.

## Reproduce the engineering checks

After building the standalone gateway and installing the repository's locked
Chromium prerequisites as described in README, run:

```sh
FISCH_CAPABILITY_REQUIRE_GATEWAY=1 npm test -- tests/expression-composition-e2e.test.mjs
npm test -- tests/live-face.test.ts tests/live-reactive-body.test.ts
```

The actual MCP/Rust/WebGL test uses freely authored synthetic geometry: standalone
form, avatar plus a separated mark, activity during the compound scene, overlay
remix, and cancellation. The fixture is test input, not a production mapping from
language or emotion. CI's gateway job includes this test and requires its runtime.
Optional FISCH_COMPOSITION_EVIDENCE points to a directory outside Git for PNGs and
structured evidence. Early logical-completion and later 500 ms review snapshots
are retained separately; completed does not mean the rendered transition has
settled. This fixed review interval is not a latency or convergence guarantee.
Debug masks identify particle groups; they do not recognize
objects. Avatar geometry is compared in scene coordinates because camera autofit
can legitimately rescale the raster when another component changes the extent.

Part IDs, ACKs, frame hashes, output bounds and nonblank pixels cannot establish
that a viewer recognizes a form or finds it contextually appropriate. Review the
composite PNGs without labels, then assess recognition, coherence and transitions
with a person. This scripted engine test makes no real-model, live-camera, voice
or human-naturalness claim. The existing external agent still chooses expressions.

## Frozen external-agent choice holdout

[expression-choice-holdout.json](expression-choice-holdout.json) contains eight
independent synthetic Vietnamese contexts and four separate continuation pairs,
frozen by QA before inference. Feed only case.message, using unchanged production
instructions; do not send the manifest, labels or evaluation text to the model.
There is no expected shape/color/effect. Quiet/uncertain outcomes may abstain.
Do not tune on these cases then call them untouched holdout.

For blind review, randomize whole-output clips under opaque IDs without agent
captions, part names or prompt text. First ask what is visibly present/changing;
then reveal the context and ask whether the choice fits or distracts. Reveal the
agent's explanation last. Report recognition, contextual fit, transition clarity
and disagreement separately; set no invented human pass threshold. Record first
tool, first expressive tool and full Native turn timing separately, with null for
missing events. Keep lifecycle admission/application/terminal and raster evidence
separate. Continuation turns are conditioned trials, not additional independent
contexts. A working authenticated Native executor must run this manifest; the
scripted composition fixture is not evidence of autonomous model choice.
