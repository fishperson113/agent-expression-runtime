# Real-wall reactive opportunity evidence

One continuous synthetic run exercised the actual browser/renderer and Node
broker for **20 minutes**. Host elapsed: **1,200,064.995 ms**; browser elapsed:
**1,200,128.8 ms**. This is separate from the [77-scenario virtual matrix](reactive-opportunities-results.md)
and its [method](reactive-opportunities.md), published in [PR #89](https://github.com/fishperson113/agent-expression-runtime/pull/89).
The wall run used exact source `354d6428ea29255229a9a24c67332583bc7635bc`;
the published virtual matrix was regenerated at `dc6641203f246b09d5e80343cff62326ce51aee4`.
They are distinct source snapshots, not a single interchangeable result.

## Observed result

| Opportunity cohort | Quiet, 600 s | Active, 600.129 s |
| --- | ---: | ---: |
| Actual synthetic source frames / source-valid frames | 11,451 / 11,451 | 11,448 / 11,448 |
| Raw smile target flips | 0 | 300 |
| Actual FaceObservations semantic opportunities | 1 arrival | 299 expression changes |
| Authorized fake-provider requests / returned decisions | 1 / 1 | 40 / 40 |
| Owned admission / application / completion | 1 / 1 / 1 | 0 / 0 / 0 |
| Owned frame-submitted / changed-hash proxy | 1 / 1 | 0 / 0 |
| In-flight first revocation reason | none | 40 semantic_changed |
| All renderer frame advances, including ambient | 29,654 | 29,888 |

The arrival positive control reached actual Scheduler completion and reactive-owned
ThreeRenderer frame proxies. Its source-opportunity-to-application latency was
3,073 ms, from one sample. The remaining quiet completed-response silence was
595,291.7 ms with **zero new semantic opportunities**, so additional inference
was not expected. The active cohort had 600,128.8 ms of application/completion
silence containing **299 semantic opportunities**; all 40 returned decisions
were revoked before admission. That is a conditional visual-silence risk for this
input/latency/policy combination, not a claim that all interaction is broken or
that zero reactions is desirable behavior. Ambient movement is not credited as
an observer response.

No provider request, browser transport, active lease or Scheduler program remained
pending at the endpoint. One raw flip had no corresponding confirmed semantic
event before the boundary, consistent with the last 128.8 ms being shorter than
the classifier's 300 ms confirmation interval. That upstream boundary effect is
distinct from provider/action censoring.

## Method and scope

An independent loopback Vite page imported actual `FaceObservations`,
`ReactiveSession`, `LiveBody` and `ThreeRenderer` from a local Git archive of the
pinned source. Node used actual `LiveReactiveBroker`, an injected fake provider
with a 2-second delay, and nominal 100 ms polling. The fixture returned a valid
600 ms `shapeQuality` action: rise=.15, advance=0, grow/spread=1. It is diagnostic
test code, not a production keyword/gesture effect rule.

The source supplied uniform synthetic 478-point landmarks, identity head matrix,
continuous sinusoidal position and actual `FaceObservations` smoothing/debounce.
Nominal source rate was 20 Hz; the second ten minutes alternated raw bilateral
smile targets every two seconds. No samples were fabricated to fill missed ticks.
Source-gap p95/max were **79 / 1,497.1 ms**; broker-poll-gap p95/max were
**109.95 / 2,241.37 ms**. The 41 actual fake-provider delays had p95/max
**2,017.71 / 2,043.13 ms**. Source validity is reported at received-frame samples,
not asserted continuously between them. Large measured gaps are retained.

Whole-window counters intercepted actual trace calls with reactive
request/decision/action attribution, separately from all renderer advances.
They did not use the recent-60-second recorder. Admission, application,
completion, submitted-frame/hash proxies and semantic meaning remain distinct.
There were zero real model calls, media calls, page errors, context-loss calls
or aggregate overflows. The renderer used 2,000 particles and software Vulkan
SwiftShader; this is neither native GPU acceptance nor model-quality, detector
accuracy, natural-human event-rate or enjoyment evidence. No human participated.
Cleanup/abort/disposal happened outside the measured counters.

## Additional production-hand-source virtual controls

The [supplemental controls](evidence/reactive-current-hand-controls.json) were run
at source `cae41252cef5e88d185214da34c37cb87531f5bd` on runtime base
`2b6b8ad`, after production hand-observer wiring. They are **two separate
20-minute virtual-clock face scenarios**, with 100 ms polling and 64 diagnostic
particles, zero model/media calls, and no browser/ThreeRenderer GPU measurement.
They are not another wall run and do not establish hand-tracking acceptance.

The quiet control had one arrival opportunity/request/application/completion.
The 0.5 Hz / 2-second-delay control had 600 opportunities, 80 requests, 80 first
`semantic_changed` revocations and zero admissions. That preserves the selected
qualitative contrast on this newer source; it does not establish source-byte
identity or validate all current inputs. Each virtual scenario starts with an
arrival and lasts 20 virtual minutes, so its active denominator differs from
the original wall run's second ten-minute cohort. The older `dc66412` 77-row
matrix and original `354d642` wall artifact remain separately labeled above.

For selected-control reproduction, use a prepared checkout of the supplemental
source and bundle/import `runOpportunityScenario` from
`scripts/reactive-opportunities-probe.ts` with the installed esbuild dependency.
For each rate in `[0, 0.5]`, call
`runOpportunityScenario({rate,latency:2000,seed:0,mode:'fresh'},1200000,100)`.
This advances virtual time; it is not a request to wait for or rerun the full
wall experiment. Label any regenerated result with its actual checkout source.

## Immutable artifact and maintained reproduction

The [original 7,615-byte JSON](evidence/reactive-wall-354d642.json) is preserved
verbatim. SHA-256: `bbd7e415ced56a93c280adc44608fb021f1279a45d41cdcfe3e3c6fc49ccaa6a`.
Original private driver hash: `f746c1420ea90cfe8e5982e4e2fd0178185769325560b9aabb22e1c53cd37793`.
The browser fixture retained here is byte-identical to that run:
`a3cd7530b426819cd829464b2ec31253367d3eb2bb45f74f3f688301146c4b3a`.

The maintained Node runner was refactored **after** the recorded run. It was
validated only with a short smoke; it did not produce the archival 20-minute
artifact. It uses a dedicated temporary Vite cache and reports its own Node/browser
versions. It runtime-archives the same pinned local Git object, without committing
archived/bundled runtime code or fetching Git history. Install repository
dependencies and Playwright Chromium beforehand; Git and tar must be available.

```sh
node scripts/reactive-wall-probe.mjs --smoke
node scripts/reactive-wall-probe.mjs --full --output .runtime/reactive-wall-full.json
```

Default mode is the 20-second quiet + 30-second active smoke. `--full` explicitly
selects ten minutes per phase; it is manual and is not part of CI. Both modes
remain synthetic-only, use no model credentials or budget, store only sanitized
counts/timings, and make no automatic policy change. No second full run was made
for the runner refactor. Integrity tests protect provenance and accounting;
they do not assert the observed zero-reaction active outcome as a target policy.
