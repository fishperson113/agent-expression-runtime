# Scoped reactive V2: verification and rollout

V2 is explicit opt-in. It addresses two measured V1 control failures: eligible expression churn
could revoke every delayed response, and the request deadline could cut off a valid expression
immediately after admission. The five-second admission cutoff, rolling quota, cooldown, consent
and user priority remain in force. This report evaluates orchestration with synthetic inputs and
fixed fake provider outputs; semantic relevance and naturalness remain unverified.

## Requirements and implementation

| ID | Requirement | Implementation and regression evidence |
|---|---|---|
| CAU-04 | A compatible optional state change must not invalidate a generic phrase; selected dependencies must match | Required semantic history snapshot and explicit unique prerequisites; `reactive-v2`, `reactive-session-v2`, `semantic-axes` tests |
| CAU-05 | Consent/source, session, epoch, presence, user intent, required tracks and hand history cannot be waived | Critical host/lease checks plus immediate live identity latching, including unknown→known→unknown and loss→return |
| ACT-03 | An admitted phrase may finish within a short host lease without extending admission | Exact nonspatial AST, 200–1,000 ms leaves, independently checked compiled duration, host duration +100 ms, maximum 1,100 ms |
| NEG-01 | Contract mismatches must consume no budget or HTTP request | Explicit backend contract version, browser negotiation, strict outer/window equality and pre-reservation rejection |
| REC-02 | Trace admission and execution validity independently without raw model output | Strict versioned request projection and trusted accepted-only execution expiry; unchanged opt-in60s recorder |

## Seven real-wall browser comparisons

Pinned tested tree `41811b2aed42a4e768784b5bd82396f9acc48a36` from combined commit
`38d0b79bb97c45846579ed3c9474578da0a3a21d`. This tracked tree matched intermediate live
integration PR #96 head `4624da8`. Released main `07bbac210a38d5ab985e534c1bfbffa23f8d9f8b`
additionally includes parallel setup/Windows changes from #93; its full tree differs. V2
core/session/contract modules are unchanged, and current CI covers the integration. Latest-main
critical browser verification is reported separately below. Chromium/SwiftShader, actual
FaceObservations over synthetic gated face scores, actual Node adapter with loopback fake HTTP,
actual Body admission/scheduler/render proxy. No virtual clock or production model calls.

| Scenario | Observed outcome |
|---|---|
| V1 expression changes every2s, provider2s | Revoked; no action applied |
| V2 generic prerequisites[], same source/provider | Admitted, applied, frame-change proxy, completed |
| V2 expression prerequisite, same source/provider | Stale; no action applied |
| V1 provider4.5s,500ms phrase | Applied, then cancelled before completion |
| V2 provider4.5s,500ms phrase | Completed73.3ms after admission deadline and90.9ms before host lease expiry |
| V2 provider5.2s | Revoked; no action applied |
| V2 accepted action then user intent | Cancelled immediately; no completion |

Seven complete scrubbed bundles,92 parent references, zero missing parents. Seven fake HTTP
requests, zero actual model calls. Frame-change is a renderer proxy and does not establish first
visible motion or capture-to-photon latency. This small fixed comparison is not a statistical
model-quality benchmark.

## Continuous Cloud measurements

Baseline V1: 60 s warm-up plus30m0.792s continuous real wall measurement,1801 measurement
samples, max telemetry gap1194.4ms, no missing intervals.62 dispatches, maximum4/rolling60s;61
fake provider calls, maximum concurrency1.20 actions applied,17 completed,3 cancelled;15 late
responses. No nonfinite position, tested abs4 bound violation or WebGL context loss.

Owned Chromium process private memory334,729,216→377,077,760bytes (+42,348,544),
peak387,706,880; fitted slope+1,538,314bytes/min. JS heap end below baseline does not negate
positive process-memory slope. RustRSS+176,128bytes. No forced GC. This does not prove leak
freedom. Source p9567.6ms and rAF p9550ms are synthetic Cloud cadence proxies, not webcam
latency. A stillness block changed track ID near a350.5ms source gap; the Native-priority
segment involved hand motion and is not an isolated still-hand test.

V2 measured 20 minutes 0.208 seconds after a 60-second warm-up: 80/80 measured requests were
authorized, sent to fake HTTP, accepted, admitted, applied, frame-proxied and completed. Whole
run: 84 requests. Expression changed during 79/80 measured requests. Maximum four dispatches per
rolling minute; minimum spacing 15,000.7 ms; longest applied-action start silence 15,125 ms
including window edges. This cadence is constrained by the deliberate cooldown, not a promise to
express for every source event.

Independent host telemetry contains 1,201 measurement samples, maximum gap 1,043.1 ms and no
missing intervals. The product recorder remained off. All candidate source references join, but
one producer sequence gap 528→530 precedes consecutive gateway cursors 528→529. Therefore 599
measured source events are a lower bound; complete opportunity capture is unproven. The
historical cause is unknown. Offline review found a compatible mechanism in the gateway's silent
60 ms ingress throttle; that does not prove which packet was lost in this run. This mirror is
separate from direct browser→Node reactive candidates.

V2 Chromium 156 private memory: 337,895,424→389,124,096 bytes (+51,228,672), peak 389,468,160,
slope +2,450,016 bytes/min. Heap grew 22,839,988 bytes at the sampled endpoint; Rust RSS grew
98,304 bytes. Source p95 61.5 ms and rAF p95 50.1 ms; maximum source/rAF gaps 836.6/800 ms are
retained. This is a 20-minute Cloud profile, not the 30-minute target-device gate or proof of
leak freedom.

## Latest-main critical witness

On main `07bbac210a38d5ab985e534c1bfbffa23f8d9f8b`, Chromium 141/SwiftShader completed five
real-clock cases: a continuously moving primary hand completed a 2-second fake response; first
hand return before appearance debounce, face withdrawal, and unknown→known→unknown hand
availability revoked delayed responses before admission. Their responses still had approximately
2.8–2.95 seconds of admission validity, excluding timeout as the cause. An already applied
action cancelled after a denied-source transition and did not complete.

Denied source also changes presence; its first reason was presence_changed, so this is not an
isolated source-health-only test. Current post-dispatch counters are not publicly exposed: raw
transitions, captured prerequisites, revocations and effects provide the evidence. The five
scenarios took 26.37 seconds and made five fake HTTP calls, zero actual model calls. Performance
results across browser profiles are not pooled.

## Checks and remaining gates

Main `07bbac2` passed TypeScript/Vite build and the complete suite: **664/664 tests, 98 files,
zero skips**, 229.92 seconds, with a verified same-source Rust gateway and required gateway
checks enabled. This supersedes the earlier combined checkout's 640 pass/8 native-gated skips
plus 24 follow-up passes. Independent bounded review found no confirmed P0/P1 in the V2
boundaries. PRs #92, #94, #95 and #96 merged only after current CI and scoped harness checks
passed. Subsequent ingress-mirror work needs its own validation and does not retroactively erase
the recorded gap.

No production model calls were made. Dedicated provider configuration and an existing approved
cumulative budget ledger/deadline remain unavailable; the100/120 handoff has not been
reconciled. Synthetic fixture ledgers/reservation callbacks are not that budget. PR#51 remains
draft because historical unrelated-output provenance is unresolved; the camera observer now has
a separate enforced data-only capability boundary.

The CC0 video perception smoke test yielded only two valid primary-hand frames among60, and no
hand event passed debounce. It supplies no gesture classifier accuracy claim. HandS checksum
mismatch remains quarantined. Physical-device/live-camera and human enjoyment/naturalness gates
remain open; no new voice frontend is introduced.

Existing local static pose labels and scores do not enter typed reactive observations;
landmarks survive, while the translated summary is stripped. Reusing that classifier needs
a versioned pose field, reliable track association and an explicit hand_pose dependency.
It is not evidence that Laya/Jev or gesture understanding has been integrated.

## Opt-in and rollback

After coordinated Node/core/browser/recorder versions are installed, set
`FISCH_REACTIVE_CONTRACT_VERSION=2` alongside the already authorized dedicated observer
configuration and existing cumulative ledger. This flag grants no credentials, budget or
media-upload permission. Default remains1. An old browser and V2 adapter mismatch fails before
reservation/network.

To roll back, disable the reactive backend or select version1, revoke scene authority, and
restart/reconcile any unresolved transport before re-enabling. Never retry an unknown outcome.
Preserve versioned trace bundles; older readers must reject unsupported V2 payloads rather than
reinterpret them. Recorder retention and raw-media defaults stay unchanged.
