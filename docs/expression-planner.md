# Contextual expression planner

Run `fisch run` beside your existing Codex or Claude pane. Fisch observes agent status and recent terminal context automatically; the main agent needs no Fisch tool calls. No browser or interactive agent window opens.

The native backend follows the attached agent: a persistent `codex app-server --stdio` process, or `claude -p`. Both use existing CLI authentication. This is separate inference, not access to the main agent's hidden reasoning or in-memory conversation. Provider usage and account charges still apply. An external API is optional.

## Context and timing

Fisch reads up to 32 recent unwrapped lines from the selected agent pane, clipped to 6,000 characters. Common credentials are redacted, but arbitrary terminal output can contain sensitive data. Context travels through process stdin rather than command arguments. Fisch does not save these excerpts to conversation files; CLI/provider retention policies still apply.

Context is sampled at most every two seconds without model usage. Planning has a 60-second minimum spacing within a work phase; native inference also uses a 750 ms quiet window and a 45-second deadline. A new work phase may request an initial plan immediately. Subsequent context must differ by at least 35% of the union of word tokens from the last requested context. Numbers and word order do not count; small accumulated log additions must eventually cross the threshold. This local heuristic is not semantic intent recognition and can miss short meaningful changes. Terminal updates coalesce instead of repeatedly killing inference. Working-to-idle/done transitions accept the same turn's pending result. New work, interruption and manual control invalidate obsolete jobs. Rendering continues throughout.

Codex keeps one process warm with fresh ephemeral threads. Generation still takes seconds: a live signed-in call with the current schema took about 13 seconds. Local repertoire playback supplies immediate motion while the model runs. Keeping a process warm does not guarantee faster generation.

## Geometry and repertoire

Model output contains a short concept label and a bounded AST with at least one assembly. Up to four sequential beats may each contain three parallel primitives, lasting 200–1,500 ms per beat. The prompt asks for coherent silhouettes, independent part motion and concepts different from recent history. Schema guards and the compiler reject invalid geometry or property conflicts. Failure preserves the current body or bootstrap reflex. See [swarm geometry](swarm-geometry.md).

Up to eight distinct model-authored compositions are retained locally. Idle/done rotates them every 12 seconds; working rotates them every 18 seconds. These are local engine submissions, not fresh AI decisions. Ordinary working/idle transitions preserve geometry and adjust brightness instead of resetting to sphere/cloud/wall. An empty repertoire uses status reflexes until the first valid assembly arrives.

The ignored `.runtime/repertoire.json` stores bounded geometry ASTs and concept labels, without terminal excerpts or credentials. Restarting restores these forms immediately. Set `FISCH_REPERTOIRE_CACHE=off` to keep only an in-memory repertoire. Geometry fingerprints deduplicate near-identical forms; semantic originality is not guaranteed.

Idle/done waits five minutes before requesting a fresh plan, then waits another five minutes after completion before a second attempt. Each idle period permits at most two requests, including failures. Terminal text changes and idle/done transitions cannot bypass the delay or replenish this budget. Only resuming working resets the budget; a working request already in flight may still finish during idle without spending an idle request. After exhaustion, local repertoire animation continues without model calls. Status exposes `idleBudget.used`, `limit` and `intervalMs`. Manual expressions/cancellation pause automatic activity until a later context/status change; requests also respect a ten-second hold after manual control. Closing Fisch stops inference and replay.

## Configuration

No settings are needed for native CLI planning. Optional settings come from the checkout's ignored `.env`, with environment variables taking precedence:

```dotenv
FISCH_PLANNER_BACKEND=codex
# Alternatives: claude, api, off
# FISCH_PLANNER_MODEL=your-model
# FISCH_PLANNER_COMMAND=/absolute/path/to/codex
# FISCH_REPERTOIRE_CACHE=off
```

`fisch status` reports attempts, fresh `applied` plans, discarded results, sanitized errors, the last AST/concept, repertoire size/play count and process/request counts. `bodySource` distinguishes `reflex`, `repertoire`, `planner` and manual control. Admission counters do not certify human recognition. Backend `off` retains status reflexes without reading context or starting inference. API credentials alone never select the API backend.

Codex runs outside the repository in a temporary scratch directory, with normal authentication/configuration retained. Configured MCP servers, shell, apps, plugins, hooks, multi-agent, browser/computer and image features are disabled. Threads are ephemeral, read-only and receive planner instructions instead of repository instructions. See the official [Codex app-server protocol](https://developers.openai.com/codex/app-server). Claude remains a separate tool-free, nonpersistent process per request, without external MCP configuration or settings sources. Neither path edits the main agent's configuration. Compatible recent CLI versions are required; failed inference leaves local animation running.

## Optional API backend

```dotenv
FISCH_PLANNER_BACKEND=api
FISCH_PLANNER_MODEL=your-structured-output-model
FISCH_PLANNER_URL=https://api.openai.com/v1/responses
OPENAI_API_KEY=your-private-key
```

Keep keys out of chat and Git. The transport uses [Responses structured output](https://developers.openai.com/api/docs/guides/structured-outputs) with `store: false`, a four-second deadline and the same quota scheduling as native planning. Localhost endpoints may use HTTP without a key; other endpoints require HTTPS. `FISCH_PLANNER_API_KEY` supplies custom endpoint credentials. OpenAI credentials are never automatically forwarded to another hostname.

## Verification and limits

Tests cover throttling/redaction, coalescing, invalidation, timeouts, malformed plans, child-process cancellation, bounded RPC/HTTP, fresh ephemeral threads, cache restoration/deduplication and preserved geometry across working/idle transitions. Live signed-in Codex inference is verified; live Claude inference and human assessment of expressiveness remain unverified. Terminal context is lossy and includes tool output. Braille has lower detail than WebGL and cannot establish subtle perceptual differences. Plans communicate context; they are not evidence of private emotions.
