# Fisch Live: experience research and test-first acceptance

Research snapshot: 2026-11-09. Scope: QA/QC/BA proposal, not implemented feature
claims or human acceptance. No real camera, microphone, private prompts or personal
machine were used. Public primary product descriptions were inspected as text;
their promotional videos were not independently watched or benchmarked. TikTok
was not required; no access restriction was bypassed.

## What the market suggests

| Primary source | Observed offering | Transfer to Fisch | Evidence limit |
| --- | --- | --- | --- |
| [Project Astra](https://deepmind.google/models/project-astra/) | Context-aware interaction, proactive response, multimodal memory | Refer to an actual earlier shared creation and respond to changes | Research prototype; no evidence of Fisch latency or retention |
| [Hello, Dot, May 2025](https://www.nianticspatial.com/en/blog/peridot-hello-dot-global) | Multiple minigames, rewards and appearance customization | Alternate activities and let a shared creation evolve | Mixed-reality hardware; rewards are not proof of sustained enjoyment |
| [Eilik](https://www.energizelab.com/eilik/) | Touch/vibration responses, expressive body, small games and character interaction | Clear bodily cause/effect plus playful recovery | Physical embodiment differs from particles; marketing claims are not measured effect sizes |
| [EMO](https://living.ai/emo/) | Autonomous exploration, expressive movement, games and evolving interaction | Quiet autonomous presence and varied reactions | Sensor-rich robot; do not infer a particular controller or general intelligence |
| [AI Desktop Pet developer listing](https://store.steampowered.com/app/4227700/AI_Desktop_Pet/) | Screen-aware conversation, local models and configurable avatars | Context and personal authorship can complement a visible body | Developer description, not independent test; screen capture is outside this slice |
| [Iron Interface](https://collidingscopes.github.io/iron-interface/) | Pinch zoom, hand rotation and spoken pattern selection | Continuous control should have immediately understandable feedback | Listed presets do not demonstrate free-form agent meaning; no camera/mic enabled here |
| [HandSynth](https://handsynth.com/about/) | Browser hand instrument with mouse/touch/keyboard fallback | Keep creation usable when tracking is unavailable | Music instrument, not evidence for adding audio to Fisch |
| [Hand Physics Lab](https://www.holonautic.com/hand-physics-lab/) | Building, drawing and varied physical interactions | Editable playground plus several optional goals | Headset tracking is different from a webcam |
| [Quick, Draw!](https://quickdraw.withgoogle.com/) | Short guess/correct rounds including recognition failures | Make correction part of play, rather than hide model mistakes | Drawings contribute to public data; do not transfer that privacy model |

Design inference: a single surprising animation makes a good clip but leaves no
next action. A promising loop combines understandable response, user authorship,
variation and recoverable mistakes. These sources motivate hypotheses, not a
claim that this loop keeps people entertained for 20 minutes.

## Recommended slice and priorities

P0 is a **particle improv partner**: the user and agent build a small creature or
abstract object, change one rule, and see a short performance respond to that
rule. The agent authors geometry and beats through the existing bounded DSL.
The runtime must not recognize a prompt keyword and pick its animation.

| Candidate | Why it might feel special | Smallest reviewable slice | Priority / dependency |
| --- | --- | --- | --- |
| Co-create and remix | User sees their own unusual idea become a body | Create, alter silhouette or motion, explain what changed, return to face | P0; existing assemble/express/return-to-face |
| Three-beat improv | Anticipation, attempt and recovery give an action a tiny story | Agent-authored staged beats with interrupt at each beat | P0; staged poses exist; contextual quality pending |
| Shared-rule play | User changes the rule and catches the agent adapting | One round at a time, explicit start/end, user can reject or change rule | P1; session rule/memory contract must be specified before implementation |
| Observation-based playful response | Body reacts to a supported change while conversation continues | Optional typed replay now; real camera only by user opt-in later | P1; no inferred mood, gaze or speech from geometry |
| Call back to shared creation | Continuity gives a reason to keep playing | Reference a creation actually present in session context; admit missing context | P1; bounded session memory/reset behavior pending |
| Competitive economy, achievements, voice, screen awareness | Broader retention possibilities | Deferred until the core loop passes human evaluation | P2; unnecessary scope for tonight |

Do not score model creativity by exact shape names or caption words. Assess
whether the output addresses the held-out request, visibly differs where asked,
remains within constraints, and acknowledges uncertainty. Gesture labels remain
observations; a label must not directly select geometry or inferred intent.

## Three independent gates

1. Deterministic correctness: synthetic replay, injected clocks, resource and
   lifecycle checks. Run the companion test and existing Live suites. This can
   pass without any model and says nothing about fun or camera accuracy.
2. Integrated robustness: a real elapsed 20-minute synthetic session exercises
   gateway/browser/model integration. Label synthetic mode. Capture redacted
   phase counters, timings and queue bounds; no prompt/image payload. Never
   substitute a fast virtual-clock test for this soak.
3. Human experience: a separate uncoached session and blind, counterbalanced
   comparison establish relevance, amusement and distraction. Pending until
   people actually participate; automated proxies cannot pass this gate.

Trace event -> eligible -> model request -> decision -> admitted -> applied ->
frame proxy -> completed/cancelled. Existing trace may expose only some phases;
record unsupported phases as missing. Admission is not display, a changed hash
is not semantic relevance, and completion is not enjoyment. Measure local reflex
latency separately from model and total interaction latency. Retain failed and
cancelled attempts in denominators, with clock origin and sample count.

## Reproducible 20-minute robustness session

Use a fresh session, fixed replay seed 9011, fixed 2,000-particle quality and
recorded viewport/build/browser/delegate. Camera and voice stay off. Inject typed
synthetic observations through existing test interfaces; never imply they came
from camera inference. Use monotonic timestamps, reset before every repeat.
For model runs record provider/version/settings and allow semantic variation.

| Elapsed | Activity and perturbation | Observable pass condition |
| --- | --- | --- |
| 0–2 min | Start camera-off; make one unusual creation | No permission request or media start; accepted geometry reaches applied phase |
| 2–5 min | Remix shape, then motion, then undo/return | Each requested change is distinguishable; prior control ownership releases |
| 5–7 min | Do nothing | No idle model request; no event backlog; no nagging escalation |
| 7–10 min | Three improv rounds; interrupt at preparation, hold, recovery | Obsolete effects stop; terminal remains responsive; later request can succeed |
| 10–12 min | Synthetic tracking/absence/stale and camera-status transitions | Unknown data cannot retain a fresh pose or emotional claim; no automatic camera start |
| 12–14 min | Burst observations, delayed model response, expired lease | Latest supported state wins; bounds hold; late effects do not replay |
| 14–16 min | Inject invalid AST and model/network failure, then retry | Atomic rejection; current safe body survives; explicit retry succeeds |
| 16–20 min | Unscripted operator choices, including motion-off and stop | No coaching; stop works; log every failure and voluntary choice |

This is a robustness script, not a valid uncoached enjoyment study. For each run
record elapsed time, scenario outcomes, errors, peak bounded queues, inference
count during silence, p50/p95 phase latency and memory start/end. Follow existing
benchmark procedure for performance; software GPU results cannot certify native.

## Test matrix written before feature work

Status: COVERED means an existing named suite targets the invariant, not that it
was executed in this research. NEW means companion tests are runnable. PENDING
means no acceptance evidence exists. Recheck status at the exact release SHA.

| ID / priority | Input or fault | Expected result / oracle | Status and owner |
| --- | --- | --- | --- |
| Q01 / P0 | Fresh launch, deny, stop, delayed recovery | Media stays off until explicit opt-in; manual stop cancels recovery | COVERED live-privacy/live-session; integration QA |
| Q02 / P0 | All 7 static hand classes at confidence .749/.75 and 249/250 ms | Weak/brief signal unknown; threshold confirms label only | NEW experience-replay; perception QA |
| Q03 / P0 | Remove hand then wait 501 ms; replace pose | No retained gesture or invented action | NEW experience-replay; perception QA |
| Q04 / P0 | 20 min virtual input with intermittent denied/stopped/error | Deterministic results; unknown fields immediately cleared | NEW experience-replay; not elapsed soak |
| Q05 / P0 | Arrival/departure chatter around 1 s, head change around 700 ms | No event storm; immediate tracking distinct from confirmed event | COVERED live-observation; add noisy replay in integration |
| Q06 / P0 | Two minutes of stillness/no-op | Zero new model requests attributable to idle; bounded quiet motion | COVERED live-model-budget; real elapsed integration PENDING |
| Q07 / P0 | Burst then stale/TTL-expired input | Queue/rate/lease bounds; no stale effect later | COVERED live-contracts/live-controls/live-session; integrated trace PENDING |
| Q08 / P0 | Interrupt each staged beat; cancel when admission uncertain | Explicit cancellation state; no success inferred from pending receipt | COVERED live-controls/live-cancel; integrated three-beat PENDING |
| Q09 / P0 | Reload/session loss after accepted expression | Old epoch cannot replay; new explicit request restores operation | COVERED live-cancel/live-session; QA |
| Q10 / P0 | Invalid geometry or model error during play | Reject atomically; keep controls usable; no fake completed beat | COVERED live-controls/live-reactivity; model fault integration PENDING |
| Q11 / P0 | Motion-off, reduced-motion, stop during dense animation | Off persists; reduced stays bounded; stop works using keyboard | COVERED live-face/live-browser; human accessibility PENDING |
| Q12 / P0 | Camera absent/stale, mouth motion, smile, head turn | Unknown stays unknown; no mood, speech, identity or true gaze claim | COVERED live-observation/live-contracts; semantic holdout PENDING |
| Q13 / P1 | Same phrase under different scene/rule, paraphrases under same rule | Context changes meaning appropriately; no keyword-effect shortcut | PENDING model holdout, BA + independent rater |
| Q14 / P1 | New session asks about a previous private creation | No invented memory; session reset explained | PENDING memory feature specification |
| Q15 / P1 | 10 novel requests; hidden order; adversarial irrelevant gesture | Relevant expression without forcing response to every gesture | PENDING blind semantic evaluation |
| Q16 / P1 | 20 min uncoached human play with optional exit | Actual voluntary engagement and enjoyment recorded | PENDING human evaluation |

## Human evaluation protocol, to run later

Prepare ten held-out prompts covering unfamiliar concepts, paraphrases,
contradictory requests, silence and interruptions. Keep them separate from tuning
examples. A rater who did not author the output scores relevance yes/no/uncertain
and whether the requested change is visible, without source/version labels.
Counterbalance baseline and candidate order; use identical seeds/inputs for
paired synthetic clips. Do not provide expected emotion names to participants.

For sustained experience, invite five participants to choose their own creations
for up to 20 minutes with no feature coaching after onboarding. They may stop at
any time. Record voluntary duration, annoyance, perceived control, novelty and
enjoyment (1–5), plus what they wanted to do next. Ask Dương separately for his
own 10–20-minute experience; other users cannot substitute for that requirement.

Proposed product gates, not established targets: relevance >=8/10 judged cases;
>=4/5 participants voluntarily continue for ten minutes; median enjoyment >=4/5;
no unresolved P0 defect. Report raw counts, uncertain ratings and early exits.
Small convenience samples are directional, not statistical proof. A compelling
highlight clip cannot override failed controls, frustration or early exits.

## Execution and handoff

Run `npx vitest run tests/experience-replay.test.ts`, then repository-required
`npm test`, `npm run check:architecture`, `npm run build`, and
`python3 scripts/check-harness.py`. Pending human/product tests are documented
here rather than represented as passing assertions or deliberately red CI.
Core runtime changes belong to the implementation branch. Tonight's deliverable
is this acceptance contract plus deterministic replay tests; user enjoyment,
real camera accuracy, voice and native performance remain unaccepted.
