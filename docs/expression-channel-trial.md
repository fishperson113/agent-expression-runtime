# Explicit expression channel development trial

Status: opt-in experiment, production behavior unchanged. The verified V2 result (one composition in sixteen turns) motivates investigating selection and integration; it does not establish their cause. No improvement in contextual expression or enjoyment has been demonstrated by this change.

The optional arm uses ordinary Native Codex tools. The structured arm requests one final JSON response containing `reply` and an agent-authored `retain`, `animate`, or `compose` decision. Retain dispatches nothing. Animate and compose carry existing declarative arguments, including arbitrary RGB and geometry; the host does not select effects from context or emotion labels. Ordinary tools remain available in both arms. Any observed same-turn body mutation suppresses the additional host dispatch, including failed or incomplete mutations. A truncated or missing tool trace fails closed.

This is one signed-in Codex thread with its original Fisch policy and catalog, not a second planner or a sandbox claim. `turn/start.outputSchema` constrains the final message only. The host unwraps the reply after completion; a stock Native terminal would display JSON, and this is not transparent streaming UI integration. The output contract and final host dispatch change together, so this pilot cannot isolate an instruction effect. Fresh evaluation threads do not prove preservation of ongoing task context.

The adapter binds the acknowledged turn ID, validates the complete final object, consumes each token once, checks epoch/deadline/generation, and invokes the fixed tool on that same thread's `fisch_live` server. It never retries unknown outcomes. A host integrating it into an interactive application must call `revoke()` on stop, new intent, reset, or disconnect; this experiment does not replace those production paths. Host calls use the existing epoch-aware MCP admission and ownership boundary. JSON reason codes are short audit labels, not private reasoning.

## Run

Use an authenticated Cloud environment with the existing gateway/build dependencies and ffmpeg. Do not copy credentials between environments. Supply an existing operator-managed budget ledger with sufficient remaining turns and a future deadline. The script never initializes, resets or increases that ledger; reservations include failed or unknown calls. The historical 120-turn hard ceiling was removed following the user's authorization, while the ledger's explicit configured limit remains enforced.

```sh
FISCH_RUN_MODEL_TESTS=1 PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright \
node scripts/expression-channel-trial.mjs --budget /absolute/private/budget.json \
  --output /absolute/private/evidence --model MODEL_ID --seed paired-dev-1
```

Four development cases run in both arms (eight reserved turns maximum). `--positive-control` adds two separately labeled explicitly requested tool trials; these are not spontaneous-expression evidence. Cases are disclosed, tunable development data, not a holdout. Freeze the candidate before an independently authored new holdout. Do not reuse V1/V2 as untouched evaluation.

Each trial starts a fresh client/app-server/MCP/browser, verifies the actual outbound policy bundle and same-thread composition schema, and records model, policy/schema/dataset/catalog hashes and source SHA. The paired catalog hashes must match before interpreting a comparison. Early startup or preflight failure stops the batch without consuming a model reservation. Failures remain in the report; there is no automatic inference retry.

Private artifacts contain per-turn evidence, projected replies, order/key, receipt/status, timing and actual canvas video. Blind artifacts have random codes and no context/arm labels. Review visible content and transitions first, then reveal context for relevance, restraint and answer quality. Tool counts and geometry counts are not quality scores; admission is not completion or recognition. The full clip includes waiting time and contains no camera or audio. Never publish private reports automatically.

## Verification and remaining gate

Deterministic tests cover retain, malformed output, duplicate/body-tool collision, stale intent/epoch, timeout/unknown outcomes, and callbacks before the turn-start acknowledgment. The gateway integration test uses the real MCP/gateway/renderer with a scripted same-thread RPC adapter; it is not proof of actual Codex RPC compatibility. The actual signed-in Codex paired pilot and blind human assessment remain required. This worker's existing Codex home is read-only, so it cannot start an authenticated app-server here; use the already authenticated executor without credential transfer.
