# Reactive opportunity diagnostics — full virtual diagnostic

77 scenarios × **20 virtual minutes**; this is not a real-wall soak, model measurement or human session.

Runtime checkout: `dc6641203f246b09d5e80343cff62326ce51aee4`. Baseline reference: `354d6428ea29255229a9a24c67332583bc7635bc`. Executed source files match baseline: **false**.
Executed sources differ from the baseline; these counts were regenerated and must not be labeled the old snapshot.
Changed/missing executed inputs: `src/core/live/reactive-session.ts`, `src/core/live/signals.ts`.

## Measurement

Actual FaceObservations consumes synthetic detector scores and uniform dummy landmarks at 20 Hz, with continuous position motion. ReactiveSession, LiveCompiler and Scheduler use a 50 ms virtual clock. The main matrix checks takeRequest every 50 ms; separate controls check every 100 ms to match broker polling cadence. No broker, provider transport, camera, microphone, model or ThreeRenderer runs here. Diagnostic particle count is 64, not the product performance tier.

Raw rate means score-target flips per second. It is not camera FPS or measured natural-human traffic. Actual expression smoothing/hysteresis plus 300 ms debounce determines classifier opportunities; initial presence arrival uses 1 s. Orientation debounce is 700 ms but is not varied. Raw motion alone is not a semantic opportunity.

Funnel: raw flips → actual classifier events → source-eligible events → actual takeRequest candidates → authorized fake-provider requests → returned decisions/native verdicts → admitted → Scheduler applied → completed/cancelled. CSV retains every row, source-validity denominator and all reason dictionaries. In-flight first revocation reasons are distinct from lease callbacks and actual action cancellations.

Responses always return a valid diagnostic 600 ms shapeQuality phrase, with validUntil equal to the actual request deadline. This measures timing, not relevance. The baseline policy is 750 ms first-pending-event coalescing, 15 s minimum interval, four starts per minute and 5 s request lifetime. Observed request lifetimes are stored per row; no guard is changed by this tool.

## Main matrix

Cells = requested / admitted / applied / completed / actual action cancelled.

| Raw flips/s | Raw flips | Classifier opportunities | 100 ms | 500 ms | 1000 ms | 2000 ms | 4000 ms | 4500 ms | 4900 ms | 5500 ms | 8000 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 1/1/1/1/0 | 1/1/1/1/0 | 1/1/1/1/0 | 1/1/1/1/0 | 1/1/1/1/0 | 1/1/1/0/1 | 1/1/1/0/1 | 1/0/0/0/0 | 1/0/0/0/0 |
| 0.05 | 59 | 60 | 60/60/60/60/0 | 60/60/60/60/0 | 60/60/60/60/0 | 60/60/60/60/0 | 60/60/60/60/0 | 60/60/60/0/60 | 60/60/60/0/60 | 60/0/0/0/0 | 60/0/0/0/0 |
| 0.25 | 299 | 300 | 80/80/80/60/20 | 80/80/80/60/20 | 80/60/60/40/20 | 80/40/40/20/20 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 |
| 0.5 | 599 | 600 | 80/80/80/40/40 | 80/80/80/40/40 | 80/40/40/0/40 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 |
| 1 | 1199 | 1200 | 80/80/80/0/80 | 80/80/80/0/80 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 |
| 2 | 2399 | 2400 | 80/80/80/0/80 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 | 80/0/0/0/0 |
| 4 | 4799 | 1 | 1/1/1/1/0 | 1/1/1/1/0 | 1/1/1/1/0 | 1/1/1/1/0 | 1/1/1/1/0 | 1/1/1/0/1 | 1/1/1/0/1 | 1/0/0/0/0 | 1/0/0/0/0 |

## Selected reasons and source controls

| Mode / seed | Raw flips/s / delay | Classifier events | Requests/admitted/applied/completed/cancelled | In-flight first revocation reasons | Actual action cancellation reasons |
| --- | --- | --- | --- | --- | --- |
| fresh / 0 | 0.05 / 4500 ms | 60 | 60/60/60/0/60 | {} | {"expired":60} |
| fresh / 0 | 0.5 / 100 ms | 600 | 80/80/80/40/40 | {} | {"semantic_changed":40} |
| fresh / 9011 | 0.5 / 2000 ms | 597 | 80/2/2/0/2 | {"semantic_changed":78} | {"semantic_changed":2} |
| source-loss / 0 | 0.5 / 2000 ms | 540 | 80/0/0/0/0 | {"semantic_changed":60,"presence_changed":20} | {} |
| user-busy / 0 | 0.5 / 2000 ms | 600 | 80/0/0/0/0 | {"semantic_changed":80} | {} |

The source-loss control stops synthetic observations for 2 s per 20 s. The user-busy control owns the user lane for 5 s per 30 s. These cohorts are separate from the continuously fresh main matrix; phase alignment may leave the same capped start count despite busy intervals.

## 100 ms polling controls

| Raw flips/s | Source-valid frames | Opportunities | Requests/admitted/applied/completed/cancelled | Longest application silence (opportunities) |
| --- | --- | --- | --- | --- |
| 0 | 24000/24000 | 1 | 1/1/1/1/0 | 1196200 ms (0) |
| 0.5 | 24000/24000 | 600 | 80/0/0/0/0 | 1200000 ms (600) |

## Interpretation limits

- The intentional four-per-minute cap limits dispatches; non-dispatched opportunities are not automatically provider failures.
- Applied is not completed. A response near expiry may apply yet have insufficient lease left to finish its phrase.
- Lease revocation after an already completed action is not an incomplete action. Read actual cancellation counts separately.
- Coalescing is first-pending-event anchored in the inspected baseline, not restarted by every coalesced event. Do not infer last-event debounce starvation.
- Application silence must be read with its opportunity count. Long quiet silence with no new opportunities is expected.
- Silence refers only to attributed reactive Scheduler application; ambient presence/local reflexes may still animate.
- Numerical sink calls and changed state are not actual GPU frame submissions, semantic meaning, enjoyment or native performance.
- Synthetic periodic/jitter input does not establish natural incidence or real model latency. No policy change is recommended from this matrix alone.

The separate [real-wall browser/broker report](reactive-wall-evidence.md) records a full 20-minute synthetic run at source `354d642`, with whole-window quiet/active opportunity cohorts and owned frame proxies. This virtual report was regenerated at `dc66412`; do not conflate the snapshots or substitute a rolling 60-second recorder for either method.

## Reproduce

```sh
npm ci
node scripts/reactive-opportunities.mjs --output .runtime/reactive-opportunities
node scripts/reactive-opportunities.mjs --quick --output .runtime/reactive-opportunities-quick
```

The launcher bundles actual repository imports into a disposable temporary file, then removes it. No bundled or archived runtime copy is committed. Exit failure indicates a harness/build/accounting error, never a target reaction rate. The diagnostic does not assert zero reactions as desired behavior.

Generated 2026-11-09T20:00:03.596Z; host execution 102938 ms. Main returned decisions: 4558; native verdict count: 4558.
