# Native observation conversation loop

Fisch can use the existing signed-in Codex app-server as a separate, data-only
reaction lane. It does not inject camera events into the coding conversation or
require a Responses API key. The agent chooses whether to say something, retain
the current appearance, animate it, or compose a new form. No gesture-to-effect
or emotion-to-color table is used.

## Run and boundaries

MAIN Codex may separately ask for persistent **Folder access** before opening a
working thread. Review that Native prompt yourself; Fisch does not accept it or
change trust settings for you. Being signed in does not grant folder trust. The
data-only observer runs in its own read-only temporary directory; its readiness
does not require or grant MAIN's folder trust. A test that withholds observation
events while waiting for MAIN has not tested the observer's independence.

Use the normal Live entry point from an interactive terminal:

```sh
fisch live
```

The app-server must already be usable in its own writable authenticated home.
Do not move credentials between environments. Plain production Live prepares the
Native reaction lane and arms reactions by default; no reactive environment
variables, manual ledger creation or checkbox selection is required. Camera
capture remains off until you select **Bật camera** and grant browser/OS
permission. You can disable reactions in camera settings or stop the session.
Configuration-ready and a selected thread do not prove authentication or a
successful model response; inspect the displayed status and terminal errors.

Live stores a cumulative counter and append-only reservation history under
`fisch/native-live` in the OS user-data directory: `%LOCALAPPDATA%` on Windows
(fallback `%USERPROFILE%\AppData\Local`), `~/Library/Application Support` on
macOS, and `$XDG_DATA_HOME` or `~/.local/share` on Linux. It does not invent a
test quota/deadline or reset existing history. Invalid/inaccessible history
leaves the lane unavailable rather than replacing it. Reservations are not
proof of completed inference or actual billed usage.

Explicit backend/off settings remain authoritative. An explicit
`FISCH_REACTIVE_BUDGET` still selects the existing approved ledger with its
original limit/deadline; missing, corrupt, expired or exhausted explicit state
never falls back to a replacement. For a deliberately bounded experiment:

```sh
FISCH_REACTIVE_BACKEND=codex \
FISCH_REACTIVE_BUDGET=/absolute/path/to/existing-ledger.json npm start
```

The lower-level provider factory still defaults off. Production Live opts into
its Native default; an injected provider or explicit disabled configuration is
not replaced. The optional [Responses adapter](reactive-provider.md) remains
separately configured and requires its approved budget.

Voice input is intended to use Codex's own dictation, recording then submitting
text, not a separate STT/TTS engine. Its route into the exact active Fisch relay
and thread is not yet verified. A desktop Dictate composer or CLI `/voice` live
conversation is not evidence of that route. No microphone is opened by this
reaction lane; use the existing text input until the native route is verified.

The reaction process owns ephemeral threads independent of the coding transport.
It receives typed presence/quality, event-specific facing-screen estimates,
geometric expression coefficients, or coarse hand wrist regions. Missing data is
unknown. It receives no coding task, raw media, identity, object description, or
inferred emotion. Read-only mode, verified disabled feature flags and an empty
MCP catalog constrain this POC; they are not certification of universal tool or
private-context isolation across arbitrary Codex installations.

The source and renderer continue while inference waits. A bounded event gate
coalesces events, keeps one reaction transport, and applies rolling rate limits.
Native defaults are 60 seconds for inference admission, 15 seconds cooldown and
four dispatches per minute. `FISCH_REACTIVE_DEADLINE_MS` (5000–90000),
`FISCH_REACTIVE_COOLDOWN_MS` (1000–60000), and
`FISCH_REACTIVE_MAX_PER_MINUTE` (1–4) allow bounded configuration. These do not
extend source freshness: current observations, epoch, intent, presence, tracks
and the decision's semantic read set must still hold at publication/execution.
Execution has its own finite lease beginning at admission.

A human input revokes the reaction lane without interrupting a different coding
turn. Caption and expression admission share the same causal check. Stale
results cannot publish a new caption merely because their expression was
rejected. Retain with a grounded caption is valid; retain with an empty reply
means abstention. Provider failure does not automatically retry. Unknown
transport/browser outcomes stop automatic reactions and require reconciliation
or restart; ordinary coding conversation has its own ownership.

`transportSettled:true` can mean the local reaction process has closed. Inspect
`nativeTerminalAcknowledged` and `settlementBasis` before claiming server-side
cancellation. `local_process_closed` does not imply a Native terminal ACK, stopped
remote billing, or zero usage.

## Confirmed session context

Each inference still starts a fresh ephemeral thread. The model receives at most
8 historical reactions from this engine session/epoch, with an aggregate limit
of 2,400 reply characters and a 5-minute monotonic TTL. Only a successful browser
publication receipt can confirm an entry; generated, dropped, failed or unknown
outputs never become conversation context. User intent, cancellation and source
changes fence confirmations still pending at the boundary. Session/epoch changes
clear the scope. Nothing is persisted to disk by this context store.

A confirmed entry includes text only if the browser actually inserted it.
Expression metadata says `admitted`, not visible; `currentGeometry` stays unknown.
It cannot restore or replay an earlier action. Confirmation checks the correlated
request/decision, current browser authority and Node ownership again after await.
History count/hash in Native provenance support auditing the exact input without
dumping prior text into diagnostics. This mechanism does not supply private main
coding conversation or prove the resulting dialogue feels natural.

## Reproducible acceptance

The independent PR #166 observer-only validation used the unchanged production
default with no reactive environment variables, checkbox interaction or provider
replacement. One actual Native turn completed, chose greeting/retain, and
published a browser-confirmed caption. Managed usage advanced from 0 to 1 while
old explicit ledgers stayed unchanged. MAIN trust remained unanswered and MAIN
turns were 0. This establishes the scoped observer-default path, not full MAIN
launch, expressive geometry, dictation, real-camera accuracy or natural UX. The
earlier stdin harness failure and a separate MAIN-readiness-gated attempt remain
distinct evidence; neither sent an arrival event or dispatched a model turn.

The existing `tests/live-conversation-host.test.mjs` contains both scripted
lifecycle checks and opt-in actual-model checks. Build the gateway and install
the browser dependencies described in the repository validation guide first.
The actual cases use synthetic observations through production ingestion; the
main coding connection is explicitly a protocol fixture.

```sh
FISCH_RUN_MODEL_TESTS=1 FISCH_NATIVE_OBSERVATION_REAL=1 \
FISCH_REACTIVE_BUDGET=/absolute/path/to/existing-ledger.json \
FISCH_NATIVE_OBSERVATION_EVIDENCE=/absolute/private/evidence \
PLAYWRIGHT_BROWSERS_PATH=/absolute/path/to/browser-cache \
npm test -- tests/live-conversation-host.test.mjs -t 'signed-in Codex'
```

These explicit test commands retain their approved cumulative test ledger;
the managed plain-Live usage journal does not replace that authorization.
These calls consume actual model budget. Do not rerun a silent/retain result to
select an expressive example. Keep original failures and each subsequent run
separate. Record the exact commit, projected input sequence, policy/schema/model/
config/catalog hashes, request/thread/turn IDs, actual caption, decision, renderer
receipts, and timed browser evidence. Do not commit private raw logs or tokens.

The conversation case accepts a model-selected retain alongside a visible
unsolicited caption. If the model chooses animate/compose it also requires
renderer applied/completed evidence. This is not an aggregate proof of varied
expression: that requires a predeclared finite multi-context session, reporting
every silence/retain/action outcome rather than conditioning on successful
images. Interruption is a separate case requiring continued observations, no
late caption/owner, and no interrupt sent to the main protocol fixture.

## Evidence and remaining gates

PR #150, tested head `daa7640e39756b80490c56b38c9d3b9c95539a66`, merged as
`903a6e7d77eebfc8c0c410d62c89ee000402f9ba`, passed seven CI checks. Independent
signed-in acceptance ran both opt-in cases once and passed: actual Codex produced
an unsolicited greeting with retain, and local interruption fenced outputs.
The diagnostic explicitly reported no Native terminal ACK and local process
closure. Earlier failed runs remain separate and unchanged.

This evidence does not establish two actual model lanes running together,
real-camera semantics, varied autonomous geometry, canonical server cancellation,
or human enjoyment. A 10–20 minute human-reviewed session remains a distinct
product gate. See [the SRS](proactive-srs.md) and the separate
[Responses adapter](reactive-provider.md) for the wider requirements and the
older optional API-backed path.

## Finite continuity evaluation profile

The next evaluation profile is declared before execution; it is not a record of
an executed test. Use a fresh session with the same production synthetic fixture
path every 150 ms, camera/microphone off, existing Native authentication and an
explicit cap of six observer reservations. Keep the ordinary rate/freshness/
causal gates. Do not force an expression, extend the run, or retry a silent turn.

| Seconds | Existing fixture | Interpretation |
| --- | --- | --- |
| 0–10 | `absent` | Quiet baseline |
| 10–100 | `present-neutral` | Stable presence arrives |
| 100–190 | `present-smile` | Geometric coefficients change; no emotion ground truth |
| 190–280 | `present-neutral` | Coefficients return |
| 280–370 | `present-hand`, wrist x=0.2 | Hand appears; during 340–370 alternate x=0.2/0.202 to test same-cell jitter |
| 370–460 | `hand-lost` | This fixture also removes face landmarks: combined face absence and hand loss |
| 460–550 | `present-neutral` | Return; send one fixed public main-lane user intent at 475 seconds |

At 550 seconds stop the source and disable observation. If the fixed user-intent
instant does not intersect an in-flight reaction, mark that interruption subcase
unexercised instead of retrying it. If the provider pauses or transport becomes
unknown, preserve the failure and mark dependent remaining phases unrun. A main
protocol fixture is not a second actual model.

Report every opportunity and outcome: silence, retain, animate, compose,
rejected, revoked, timed out, unknown and unrun. Correlate source/events/read set,
model inputs, caption insertion, action admission/execution and confirmation of
history. A generated result is not conversation history until browser publication
is confirmed. Cross-block continuity is evaluable only while a previously
confirmed entry remains inside its declared TTL; do not extend that TTL to rescue
a result. Prior geometry never proves the current scene or authorizes replay.

Review continuous clips first under opaque identifiers without model claims;
then reveal cues and captions to assess relevance, repetition and continuity.
Report reviewer priming and do not invent a recognition/enjoyment pass score.
Caption-only retention validates conversational publication, not geometry utility.

## Browser-operation investigation

The host broker exposes `evaluationDiagnostics()` for a bounded in-memory snapshot:
up to 32 start/settlement records and the current pending operations (at most four).
Each record contains a host-local sequence, allowlisted operation, monotonic
`atMs`, phase, elapsed milliseconds and waiter count. Pending entries report age.
Copies contain no observation payload, page exception text or model response.
These are host RPC timings, not source age, camera latency or render-frame timings.
No files or continuous diagnostic logs are written automatically.

Read this snapshot from the owning host in a test/diagnostic harness, alongside
`diagnostics()`'s first fixed failure reason/operation. A source discontinuity
alone does not establish a browser RPC timeout. The existing evaluate deadline,
capacity limit, revocation and late-result rejection are unchanged. A bounded
trace can help investigate the next failure; it does not reconstruct earlier
stalls or prove that their cause is fixed.

## Native observer MCP isolation

The observer must expose no MCP tools, resources or resource templates. A configured
but disabled server can still appear as an empty registry row in Codex's status
catalog. Fisch therefore verifies every configured server is explicitly disabled in
the observer process's effective configuration, then accepts only known, unique
rows with an empty tools map and empty resource/template arrays. Unknown names,
malformed entries, exposed capabilities and pagination still fail closed.

When inherited servers are enabled, startup closes and waits for the discovery
process before one isolated restart with process-local disable overrides. It does
not edit the user's global Codex configuration or other sessions. Unsupported
server names fail closed rather than being interpolated into CLI configuration.
The legacy provenance field `mcpCatalogVerifiedEmpty` means no exposed capabilities,
not necessarily zero registry rows.

A laptop diagnostic with synthetic typed arrival observations previously stopped
before model dispatch on eight disabled registry rows. With process isolation, a
real Codex turn produced a greeting and expression decision that the core admitted.
This is startup/admission evidence only: no camera, renderer, visual-quality or
natural-interaction result is implied.
