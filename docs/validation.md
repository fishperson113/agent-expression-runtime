# Validation scope and evidence

The current implementation includes pane attachment, native interaction hooks, contextual planning, continuous presence, model-authored performances, adaptive Braille and prepared idle scenes. See [current behavior](expression-planner.md), [review remediation](review-progress.md) and [research/evidence limits](related-work.md#10-cập-nhật-braille-theo-thời-gian-và-idle-scene-tự-do). Test counts below are historical observations, not the current suite size or a fresh certification.

## Bounded contention follow-up — 2026-11-09

Runtime stays `318af9c`. Two additional proposed graphics no-op reductions were
isolated under /tmp and tested in two alternating paired repeats each. Neither
produced a consistent gain, so neither was shipped. Model, confidence, resolution,
2,000 particles, normal motion and the existing acceptance thresholds stayed fixed.
[Complete sanitized results and candidate patches](evidence/cloud-contention-followup.json)
retain both successful and unsuccessful observations.

| Candidate | Inference change, pairs 1 / 2 | Render change, pairs 1 / 2 | Decision |
|---|---|---|---|
| Skip clears when landmark overlay is already blank | -3.01% / +0.67% | -1.35% / +1.69% | Clear calls fell 469/443 -> 0, without consistent performance gain; reject |
| Remove unused depth attachment/test | -4.59% / -0.19% | -2.16% / +0.69% | No gain; reject despite pixel equivalence |

Each window used 10-second warm-up + 20 seconds on nominal 30 FPS fake 640x480
no-face input, CPU vision/SwiftShader, fixed bird geometry and 1360x950 viewport.
Actual browser elapsed time, completed worker samples, submitted frames and rAF
intervals were measured together; bounded storage had no truncation. All eight
windows kept camera active and 2,000 drawn/simulated particles, with zero page
errors, unexpected frames or browser external/blocked requests. The small mixed
changes are not evidence of an improvement. Two rounds is the requested limit;
no third optimization was attempted.

The depth variant was checked separately in 12 framebuffer cases, including
2,000/10,000 particles, overlap/depth variation, multiple point sizes, brightness
and scales. Both contexts rendered nonblank foreground; all RGBA channels matched
exactly, with actual context depth true/false respectively. No image buffers were
persisted. That establishes this fixture's pixel equivalence, not a speed benefit.

One further Cloud gate probe kept real CPU vision running on the fake no-face
source and injected the supported `user_message` turn cue, with a declared body-y
0.3 / 600 ms `turn_changed` reflex. Ten trials measured >2 px green-weighted buffer
centroid motion: median **142.9 ms**, sampled p95 **218.2 ms**, max baseline noise
0.8765 px. The cue also activates local working/attention. This is a different
event/workload from earlier camera-off arrival tests, so it is not a direct
before/after comparison or a substitute for default/native acceptance. Readback
overhead is included; the <150 ms p95 gate remains unconfirmed under this load.
Camera stayed active, stopped explicitly afterward, with zero audio tracks,
model calls, persisted pixels, errors or browser egress. No presence injection or
synthetic-camera UI guard bypass was used.

The previous four-core/software-graphics diagnostic remains the best identified
resource limit. These bounded trials found no further safe, demonstrated gain;
backend/hardware changes and altered authored-motion semantics were not attempted.
Product runtime, persistent security/trust/device settings and credentials were unchanged.
Reservations remain 53/120, deadline 2026-11-09 06:17:35 UTC; physical/native,
human semantic and voice gates remain open.

## Vision pacing and reflex envelope — 2026-11-09

[PR #41](https://github.com/fishperson113/agent-expression-runtime/pull/41) removes
idle waiting between a slow detector result and the next fresh video frame.
Callback media timestamps coalesce to the latest available frame; one capture/
inference remains in flight. Same timestamps are not reprocessed, stop/restart
checks isolate old work, and failed transfers close their bitmap. A retired
worker error cannot stop its successor. No model, resolution, particle count or
confidence threshold was changed. Reflex poses follow their existing sinusoidal
value envelope directly; ownership still fades and binding/semantic priority,
cooldown and reduced/off behavior remain intact.

[Sanitized evidence](evidence/cloud-pacing-performance.json) retains all windows.
The immutable runtime bundles were baseline `8704ecc` and candidate `2ec30c8`;
a later stale-worker error guard changes only the stop/restart failure path,
covered by regression tests. No frontend bundle changes or browser-heavy tests
overlapped either soak.

| Camera-on soak metric | Baseline | Candidate |
|---|---|---|
| Duration + warm-up | 1,800.231 + 60 s | 1,800.234 + 60 s |
| Inference Hz min / median / max | 13.64 / 14.61 / 16.71 | 21.34 / 22.91 / 23.99 |
| Render FPS min / median / max | 30.95 / 34.06 / 44.85 | 26.69 / 30.87 / 40.83 |
| Rolling frame p95 range | 38.1–51.0 ms | 39.3–58.3 ms |
| Page-GC-normalized browser private growth | +19,615,744 B | -14,077,952 B |
| Cycles / samples | 15 / 60 | 15 / 60 |
| Errors / unexpected frames / browser egress | 0 / 0 / 0 | 0 / 0 / 0 |

Both runs used 640×480 fake no-face capture, nominal 30 FPS, zero audio tracks,
actual CPU vision, SwiftShader and 2,000 particles. Every 120 seconds the script
cancelled, alternated bird/peace geometry and resized the viewport. Camera stayed
active and was explicitly stopped at teardown. Rate uses observation-sequence
deltas in 30-second windows with constant idle turn/absent status; render metrics
cover the last 120 frame intervals at each sample. Memory sums browser-process
Private_* with page GC before/after; the negative candidate delta is a sample,
not a guaranteed memory saving. Both pass <100 MB retained growth/stability.

Vision median improves about 56.7%, while render median falls about 9.4%. This is
a documented software-renderer resource tradeoff. Sustained >=24 inference Hz,
>=50 render FPS and <=20 ms frame p95 remain unmet. Earlier alternating 20-second
pairs measured 14.15/14.05 -> 22.80/23.35 Hz, with mean result-to-next-post idle
20.68/21.62 -> 3.42/2.92 ms. Do not replace measured throughput with nominal camera
FPS or the differently averaged HUD rate.

| Confirmed-arrival buffer proxy, 10 trials each | Baseline median / sampled p95 | Candidate median / sampled p95 |
|---|---|---|
| Default arrival body-y 0.12, 600 ms | 216.2 / 226.9 ms | 160.1 / 168.8 ms |
| Declared test body-y 0.3, 600 ms | 179.1 / 209.0 ms | 130.2 / 141.6 ms |

The reproducible [latency probe](../scripts/live-reflex-latency.mjs) reloads the
page before every trial, resetting default cooldown; declared-pose mode creates
a fresh MCP client rather than replaying a stale session. Both versions use
24 Hz synthetic observations, 2.1-second absence warm-up and the same >2 px
green-weighted centroid criterion. All 40 noise floors were <2 px, camera off,
zero model calls and no pixel persistence. Median is ordinary median; sampled
p95 is sorted[floor(n*0.95)], conservatively the maximum for n=10. Debounce is
excluded, readback overhead included. Only the declared fixture meets <150 ms in
this bounded sample; the default gate stays open. The path still includes the
authored envelope, ownership crossfade, target-boid spring and frame scheduling.
No fade, gesture duration, threshold or workload was weakened to claim a pass.

From a prepared checkout, with Chromium/Edge available:

```sh
node scripts/live-reflex-latency.mjs
node scripts/live-reflex-latency.mjs --declared-pose
```

Both commands are camera-off synthetic tests. `--headed` is optional; Cloud
results above used headless SwiftShader. This does not certify display latency,
physical-camera accuracy, human semantics, native GPU/Herdr/hooks or voice.

An additional 20-second dev-module CPU diagnostic found 72.08 GPU-process
CPU-seconds out of 80.46 cgroup CPU-seconds in 20.13 seconds; quota was four CPU
cores, with throttling in all 202 measured periods and no exposed `/dev/dri`.
Main-thread sampled idle time was 16.85 seconds; `sampleBody` self time was only
0.17 seconds. This points to software graphics/media contention, not a measured
large geometry-loop opportunity. GPU-process time covers shared rendering/media
work; it is not a per-operation attribution or production acceptance benchmark.
Two supported CPU input-format trials regressed: worker-side ImageData copy
14.10 Hz, direct video-to-CPU ImageData 14.90 Hz, versus retained Bitmap control
23.05 Hz. The direct path added a 22.67 ms mean pre-post gap. Both preserved
resolution/model/confidence, produced no errors, and stayed isolated under /tmp;
neither was shipped. No further quality-preserving speedup was demonstrated in
this Cloud configuration. Raising platform quota, exposing native GPU or replacing
the pinned SDK/graphics pipeline was not attempted. Current reservations remain 53/120; deadline 2026-11-09 06:17:35 UTC.

## Restrictive TUI and source-rate audit — 2026-11-09

Current reservations **53/120**, deadline 2026-11-09 06:17:35 UTC. The real Cloud
remote TUI completed a model turn with session-only untrusted/read-only/on-request
settings, no trust acceptance, zero configuration writes and unchanged home config.
Working/replying, admitted/applied and frame-change proxies passed; camera stayed
off. [Trust semantics and repository audit](codex-project-trust.md) document the
supported restrictive alternative. Default undecided launch can still show the
dialog; persistent folder trust and native hooks were not granted or certified.

[Numeric evidence](evidence/cloud-trust-and-timing.json) corrects an input-rate
limitation: earlier fake video was 640×480 at **20 FPS**, so those observations
cannot certify 24 Hz. Chromium's official
[fake-device parser](https://github.com/chromium/chromium/blob/main/media/capture/video/fake_video_capture_device_factory.cc)
supports `fps=30`; an independent source-only test confirmed 30 FPS settings and
27.905 delivered video callbacks/s. With that setting and ordinary motion enabled,
real CPU Face Landmarker returned **285 samples / 20 s = 14.25 Hz** (rolling HUD
13.0 Hz). Mean inference was 50.28 ms, p95 77.0 ms; mean frame-post-to-result
51.64 ms. This still misses 24 Hz; source-only rate is not simultaneous inference
rate or physical-camera evidence.

A default-20-FPS timing sample gave 264 results/20 s, mean inference 45.09 ms and
post-to-result 46.73 ms. Motion-off diagnostic gave 361/20 s and means 26.36/27.22
ms. This suggests software rendering/CPU scheduling contention in this workload;
it does not establish a fixed intrinsic model cost. Worker transport residual is
small in these samples. Motion-off is not default acceptance. No runtime quality,
threshold or workload was changed to claim a pass. All new camera probes retained
zero audio tracks/persisted pixels, page errors and browser external requests;
no additional model calls were used for profiling.

Earlier sections below retain their historical checkpoints; this section supersedes
their statement that successful TUI inference is blocked by folder trust. Physical
accuracy/throughput, native GPU/Herdr/hooks/voice, human semantics, sustained render
performance and the <150 ms reflex target remain open.

## Cloud latency probes — 2026-11-09

One additional short synthetic conversation completed with a real signed-in model
on main `8c0ec0a`. Reservations at that checkpoint were **51/120**, deadline unchanged at
2026-11-09 06:17:35 UTC. [Sanitized latency evidence](evidence/cloud-latency-probes.json)
contains no assistant text, images, credentials or raw tool payloads.

| Probe | Result | Interpretation |
|---|---|---|
| Real output activity | 24 deltas; replying state 45.95 ms, next submitted frame 65.87 ms; zero 127.07 ms after last delta | Meets <250 ms / <=600 ms in this sample; state/frame proxy, not lip-sync or universal acceptance |
| Confirmed local arrival | 172.7 ms to >2 px green-weighted rendered centroid change; pre-event jitter 0.184 px | Debounce excluded; includes buffer readback, so <150 ms first-motion target remains unverified |

The reflex probe uses a declared body-y pose and synthetic observations only;
no physical camera/microphone or image persistence. Project trust/TUI inference,
physical accuracy/throughput, native hardware/voice and human semantics remain open.

## Final Cloud performance verification — 2026-11-09

Runtime `fde1444`, merged in [PR #37](https://github.com/fishperson113/agent-expression-runtime/pull/37)
as `f8ca747`. [Complete sanitized vectors](evidence/cloud-final-performance.json)
retain both 30-minute runs and the unsuccessful batched-drawing experiment.

| Gate | Final evidence | Status/limit |
|---|---|---|
| Regression | 255 JS tests / 49 files, build, architecture, strict harness, current-head Windows/core/gateway CI | Pass; R10/R11 unsupported in Codex |
| Stability/private growth | 1,800.143 s + 60 s warm-up; 15 cycles; GC private +11,149,312 B, heap +1,026,328 B | Pass for synthetic observations; no model/camera inference in this soak |
| Browser privacy | 18,601 typed observations, zero page errors/unexpected frames/off-loopback or blocked requests | Pass in this bounded camera-off synthetic run |
| Sustained rendering | FPS 35.22–60.14, rolling frame p95 16.8–42.3 ms; median metrics similar to baseline | Targets remain missed; short overlay A/B does not certify sustained improvement |
| Software vision | Explicit SwiftShader now selects CPU; fake no-face detector 5.60 -> 13.09 Hz | Improved short synthetic sample; 24 Hz still missed, physical accuracy untested |
| Overlay allocation | Same 478-marker fixture, 976 resize writes -> 0; coordinates/clearing verified | Short functional/resource evidence; fillRect retained after batch regression |

No real camera/microphone, persisted pixels, owner-PC use, credential export or
security-policy changes occurred. Project trust for real TUI inference is still
pending. The authenticated 20-turn application gate below remains separate from
human semantic recognition, distraction, native hardware and Vietnamese voice.

## Authenticated Cloud model verification — 2026-11-09

Runtime `ce03da9`, merged in [PR #35](https://github.com/fishperson113/agent-expression-runtime/pull/35)
as `d7bf017`. The owner completed official Codex device login after network access
was restored. At that checkpoint model reservations were 50/120, deadline 2026-11-09 06:17:35 UTC.

| Gate | Fresh evidence | Limit |
|---|---|---|
| Real terminal UI | Opens without Herdr; stopped at explicit folder-trust prompt; no model input sent | Project trust was not granted; successful TUI inference remains pending |
| Ordinary model conversation | Unchanged ten prompts, two fresh threads: 20/20 completed; 20 expression attempts/admissions/applications/frame changes, zero rejections | Transport/application proxies; relevance and semantic consistency unscored |
| Thread ownership | Second thread reproduced `controller_active`; explicit successful selection now awaits old controller cancellation; both-thread diagnostic and full holdout pass | Failed/superseded/background selections preserve ownership; single-controller rules unchanged |
| Active visual evidence | Twenty body-only captures; [encouragement](evidence/cloud-model-encouragement.png) and [rollback](evidence/cloud-model-rollback.png) samples | 150 ms after tool completion; agent-inspected samples, no blinded human score |
| Synthetic vision | Real Codex called observe/look and read the random image code correctly; shape/color also checked | Synthetic-only; native hook injection and real-camera vision not tested |
| Regression | 251 JS tests / 48 files, build, architecture, strict harness; current-head Windows/core/gateway CI passed | R10/R11 unsupported in Codex; CI is not native usability acceptance |
| Functional RPC | Cold observe 33.63 ms, warm p95 4.10 ms, express admission p95 16.28 ms; cancel/reload/invalid/cooldown passed, zero script errors | Isolated headless functional sample, not sustained latency or animation completion |
| Asset access | Official Face Landmarker download matches pinned SHA-256 | Physical camera unused; inference throughput/accuracy still pending |

[Sanitized numeric evidence](evidence/cloud-authenticated-model.json) includes the
failed baseline, focused before/after reproducer and every corrected holdout row.
No raw model/tool payload, credential, camera pixels or personal conversation is
included. The existing 30-minute stability evidence below is historical; the
software-rendering/vision performance misses remain misses. No new soak is claimed.
Human theme recognition >=6/10, actual-person accuracy >=8/10, distraction,
Windows GPU/Herdr, native hook trust/context delivery and Vietnamese /voice remain
open. Successful ordinary tool use does not certify expressive meaning.

## Historical Cloud terminal/face development — 2026-11-08

The authenticated follow-up above supersedes this historical network/auth status.
This run used managed Linux Cloud while the owner's computer was off. The stable browser/gateway source
is 992d48c (merged into main as 74195ca); the final Node-only thread-selection
correction is c0d63ce, followed by relay helper extraction 6ac50b7 (runtime
main merge 9e79030). The execution deadline and model
counter are preserved in [the Cloud ledger](live-cloud-run.md). The historical
native results below remain separate.

| Gate | New Cloud evidence | Status/limit |
|---|---|---|
| No Herdr required | Real Codex CLI UI and paired browser launched with HERDR_* absent; discovery and owned cleanup regressions | Launch verified; successful real model turn blocked |
| Resting face/lifecycle | Declared geometry, explicit role metadata, inspected body-only screenshots; working/replying and motion-off tests | Agent visual proxy; human perception pending |
| Illustrate/return/cancel | MCP/gateway/compiler/WebGL fixtures; restored facial geometry after wire reordering; stale gestures not replayed | Deterministic fixtures, not autonomous semantic choices |
| Output rhythm | Official agent-message delta boundaries, stale/thread/tool noise tests, <=600 ms decay | Real output streaming still needs model-connected validation |
| Synthetic observations | Present/absent/stale/denied/error, typed aggregator/bridge; no physical devices opened | Not Face Landmarker throughput or actual-person accuracy |
| Regression | 248 JS tests / 48 files, no skips; build/architecture/harness and 16 shared Rust tests/check pass | Final count/results in dated evidence and ledger |
| Warm/cold RPC | Cold observe 46.4 ms; warm observe p95 8.83 ms; expression admission p95 51.9 ms | Single headless functional sample during build load; not a latency benchmark or animation completion |
| Stability/privacy | 1,800.173 s + 60 s warm-up; GC private growth 8,130,560 bytes; zero page errors/unexpected frames/off-loopback browser requests | Stability/private-growth passed; sample FPS 34.88–54.90 and frame p95 31.5–44.7 ms miss sustained targets; no native certification |
| Ordinary unseen model behavior | Ten frozen prompts, two passes and strict shared budget driver prepared | BLOCKED: Cloud policy denies chatgpt.com; 0 completed holdout turns |
| Physical-camera inference | Model asset download denied at storage.googleapis.com | BLOCKED in Cloud; >=24 Hz remains unverified |
| Native/manual | No new owner-PC camera, Windows GPU, Herdr or Vietnamese /voice run | Pending; Windows CI compilation/tests are not native usability acceptance |

[Sanitized run evidence](evidence/cloud-live-run.json) retains both soaks, sample vectors,
asset hashes, final checks and all stated limits. Real Codex app-server control-plane
selection of two threads passed without requesting inference; that is not a model turn.

Body-only, camera-off visual comparison: [historical sphere](evidence/cloud-live-before.png),
[declared resting face](evidence/cloud-live-face.png), and [bird fixture](evidence/cloud-live-illustration.png).
The illustration was deterministic, not model-authored. Restoring the face was
also applied successfully; no page errors or active camera in the comparison.

No claim is made that ordinary conversation semantic expressiveness is fixed:
its decisive real-model gate is blocked. Explicitly separate attempted,
rejected, admitted, applied, frame submission, frame/hash change proxy, relevance
and semantic consistency. The holdout driver leaves visual meaning/relevance/
consistency unscored rather than inventing them from transport success.

Targets remain >=24 inference Hz, >=50 render FPS, confirmed-event reaction
<150 ms (excluding debounce), output activity <250 ms with <=600 ms decay,
>=30-minute stability with <100 MB GC-normalized retained private growth,
actual-person observation accuracy >=8/10 and blinded human theme recognition
>=6/10. Frame statistics are rolling 120-frame windows, sampled during the soak;
they are not a global run percentile. Missed Cloud software-rendering targets
remain misses. Preserve all existing native records and their limitations.

## Fisch Live feature-branch acceptance (2026-11-08)

Implementation and per-commit evidence are tracked in [the Live plan](fisch-live-plan.md); usage/privacy and authorized scope are in [the Live guide](fisch-live.md). The later sections below retain their historical scope.

- Final complete JS regression: 221 tests / 41 files passed with `--maxWorkers=1`; 16 Rust tests, frontend production build and architecture boundary passed. This includes vision-recovery and browser/worker-CSP regressions.
- Real signed-in Codex exercised synthetic MCP observe/look and read a random image code correctly. The interactive Herdr Live pane called observe/express/look and obtained an admitted expression; a normal first-tool approval was used, never bypassed.
- A separate native Codex synthetic sailboat request produced a six-part assembly accepted by the shared compiler. This demonstrates generation/compilation, not human theme recognition.
- Sanitized [functional evidence](evidence/live-acceptance.json) records cold observe separately (78.8 ms); warm observe p95 was 5.2 ms and expression admission p95 29.0 ms. This was a software-rendered browser run, not native GPU certification.
- Camera permission/acquisition, GPU landmark output, CPU operation and bounded GPU-to-CPU recovery have individual evidence. Some short combined-GPU probes ended the track; subsequent native GPU runs stayed active for several minutes. The interrupted/stopped attempts are not counted as 30-minute camera acceptance.
- SDK inspection exposed a logging endpoint; the final browser/worker policy blocks off-machine connections. A regression verifies both main-thread and worker fetch are denied. No real camera image was used in model vision tests.
- [Native camera/GPU soak](evidence/live-soak.json) completed 1,801 seconds after 60-second warm-up: camera continuous, 15 topology/cancel/resize cycles, no script errors, unexpected transport frames or off-loopback requests. GC-normalized private growth was 37.3 MB and heap growth 87.1 KB. Sample mean FPS ranged 58.0–60.0; rolling frame p95 ranged 17.1–29.4 ms, so a consistent <=20 ms gate is not certified. Vision remained approximately 9–10 Hz, below the 24 Hz target. Camera was stopped at teardown.

PRD gates still requiring manual or broader evaluation: observed-state accuracy >=8/10, blinded theme recognition >=6/10, native prompt-context hook trust/delivery, Vietnamese /voice, sustained distraction and an accurate Herdr output stream. Input-by-text and experimental/off output rhythm are the user-approved fallback. Additive transforms, condition-based reflex rules, arbitrary geometry/macro reflex actions and real-camera look delivery are outside this bounded implementation. Vision throughput around 8–10 Hz in short probes does not meet the 24 FPS target.

## Documentation reconciliation checks (2026-11-08)

This docs-only update was checked against implementation commit `9863ba3`. Relative link paths, UTF-8, `git diff --check` and `npm run check:architecture` passed. `npm test` passed 194 of 195 tests; the launcher cleanup test timed out navigating to local Vite before reaching its synthetic host failure. Rerunning `npx vitest run tests/launcher.test.mjs --maxWorkers=1` passed all three launcher tests. This is not a clean single-run full-suite pass or a native visual/performance acceptance result. No runtime source was changed.

## Historical initial baseline

Date: 2026-11-05. Environment: Windows x64, Node v24.15.0, Rust 1.97.1, Chromium headless with SwiftShader. Native GPU/WebView performance hardware characterization has not been completed.

| Check | Observed result |
|---|---|
| Unit/integration tests | 25 tests passed: byte splits/UTF-8, invalid input, macro revision/typing/cycles, timing, conflicts, continuity, stale epoch/seq/TTL, state patches, queue bounds, replay, published schema contracts and HTTP/MCP IR equivalence |
| Simulated overload | 3,000 records over 30 simulated seconds; queue ≤8, cache ≤64; rejections counted; cancellation clears queue |
| Core dependency boundary | Passed; no DOM, Worker, Tauri, provider or Three.js import in core |
| TypeScript + Vite production build | Passed; Three.js bundles exceed 500kB warning threshold |
| Rust/Tauri Windows `cargo check --locked` | Passed |
| Windows executable | `tauri build --debug --no-bundle` succeeded; native UI/gateway end-to-end visual acceptance remains unverified |
| Rust gateway tests | 4 passed: auth/origin/host, single controller, dedup, admission-only ACK, cancel/stale epoch, mailbox/deadline/body bounds and SSE gap/snapshot |
| Browser smoke | Offscreen worker and main-thread fallback initialized; cancellation, invalid DSL, valid morph, toggles and 375px layout passed; no page errors |
| Dependency audit | npm audit: 0 vulnerabilities after patch upgrades |

The browser smoke result in [evidence/browser-smoke.json](evidence/browser-smoke.json) contains a short rolling headless frame interval p95 around 31.9ms. It does not meet a ≤20ms interpretation and is not a native GPU benchmark. No production performance pass is claimed.

## Acceptance gaps at this snapshot

- M1: substantial implementation and deterministic tests; visual pair matrix and full schema/template edge cases remain to be expanded.
- M2 (SRS v0.3): local HTTP/SSE gateway, pairing, MCP/tool adapter, instruction bundle and TS helper implemented and tested with fake hosts. Not fully accepted: production host compatibility and human expression perception remain open. Windows Codex pane attachment and native planner inference have recorded evidence. The core needs no model key; the optional pane API planner is implemented separately from the gateway.
- M3: Tauri Channels, bounds, Worker/fallback and basic recovery implemented. Native executable build is checked separately. Native visual/recovery matrix, actual overload responsiveness and 20-minute soak remain unverified.

Fisch does not persist raw planner messages; bounded redacted interaction text is sent to the selected inference provider. Reference replay capture is explicit opt-in. Default counters exclude prompt and credential payloads. Screenshots show only generic scripted prompts. The source SRS attachment, local credentials, caches and build outputs are excluded from the public Git repository.
