# Interaction-driven expression planner

Fisch keeps free-form `assemble` generation: faces, hands, creatures and unexpected shapes remain possible. What changes is the trigger and purpose. A model plan responds to a specific user interaction; neither idle timers nor a repertoire slideshow create new shapes.

## One-command attachment

Run `fisch run` beside an existing Codex or Claude pane. Fisch installs a small command hook into the attached provider's user configuration, merging with existing hooks. It forwards events through private, pane-scoped IPC. The main agent calls no Fisch tools and receives no injected prompt. No browser or new interactive agent starts.

Codex uses `~/.codex/hooks.json` (or `CODEX_HOME`); Claude uses `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR`). Existing integrations and preferences are preserved. An invalid or concurrently edited configuration is left untouched and reported as an installation failure. Hooks are quiet, fail open and do nothing outside Herdr. Closing the body leaves the hook installed; without an attached body, delivery is a bounded local no-op.

**Codex requires native trust for new hook definitions.** Open `/hooks`, review the Fisch command and trust it. This is a Codex requirement, not an extra Fisch permission flow; Fisch does not modify trust records. Claude may require reviewing/reloading changed hook settings. The pane header, `fisch status` and `fisch doctor` distinguish waiting for hooks from receiving events. Installation alone does not prove delivery. See [OpenAI Docs: hooks](https://learn.chatgpt.com/docs/hooks) and [Claude hook reference](https://code.claude.com/docs/en/hooks).

## What drives expression

| Event | Immediate local reaction | Model use |
|---|---|---|
| `UserPromptSubmit` | Face the viewer, approach slightly and pulse quietly; keep an existing assembled form | One contextual reaction request |
| `PermissionRequest` | Orient toward the user | Eligible task event while working |
| Structured task success/failure | Small rise or hesitation on the current form | Eligible task event while working |
| `Stop` | Settle the current gesture | No new request |
| Codex `Interrupt` | Invalidate outstanding inference | No new request |
| Idle/done without a new user message | Hold the previous form, breathe and let intensity fade | **Zero requests** |

The initial attentive face is a local fallback, not a fixed-avatar restriction. Subsequent model geometry may take any supported form. Part IDs and existing topology preserve continuity where possible. Status metadata supplies working/waiting information; it never guesses the words a user said from tool logs.

Hooks receive actual `prompt` text, session and turn/prompt IDs. Subagent events are ignored. Ordinary tool output is not forwarded. Explicit exit codes or error flags can produce task events; a success cue for supported test/build commands means that command exited successfully, not that the whole project is complete. Events without a usable outcome are ignored. Current provider versions with turn IDs provide the strongest stale-event isolation; older versions without them only support session-level correlation.

## Timing, continuity and usage

Local attention precedes inference and does not wait for a model. It aims for subsecond acknowledgement, but exact display latency depends on the machine and CLI hook startup. Native Codex uses one warm background app-server process with a fresh ephemeral thread per request. Claude uses separate noninteractive processes. Neither reuses the main agent's hidden reasoning or in-memory chat. Existing CLI authentication is used; provider usage/charges still apply. API inference is optional.

Each new user message starts a reaction turn. At most two model attempts are allowed in that turn: its initial reaction and, if appropriate, one later task event. Failures consume attempts. Task requests have a 60-second cooldown, coalesce into the latest event, and expire after 30 seconds rather than reacting long after the moment. There is no automatic retry timer. New user messages can react immediately, invalidate older inference and replenish the per-turn allowance. Rapid user messages can therefore still consume provider usage; this is not a global hourly token budget.

Idle does not schedule inference, retry failures or rotate cached shapes. A user-message request already pending or running may finish after the agent becomes idle; it is still a reaction to that message. Lingering intensity decays locally over roughly 30 seconds. Persistent part motion then freezes at its current pose and a quiet pulse remains. Settling preserves the silhouette and session macros. Manual `express`/`cancel` pauses automatic reactions until the next user message. Closing Fisch stops inference and releases its IPC resources.

The model returns the triggering `eventId`, a communicative mood, intensity, target (`user` or `task`), a short concept and a bounded geometry AST. Relevance and continuity take precedence over novelty. A schema guard and the compiler validate each result; mismatched event IDs and superseded turns cannot overwrite newer expressions. These are performed expressions, not evidence that an agent has private feelings.

## Configuration and data

Optional settings are read from the checkout's ignored `.env`, with environment variables taking precedence:

```dotenv
FISCH_PLANNER_BACKEND=codex
# Alternatives: claude, api, off
# FISCH_PLANNER_MODEL=your-model
# FISCH_PLANNER_COMMAND=/absolute/path/to/codex
```

`off` retains local attention/settling without model calls. Fisch no longer samples recent terminal lines or automatically loads `.runtime/repertoire.json`; `FISCH_REPERTOIRE_CACHE` is retired. New prompts are bounded to 6,000 characters with common credentials redacted. Redaction cannot identify every secret. Raw user messages are held in memory, sent through stdin/local IPC, and are not saved by Fisch. CLI/provider data policies still apply. Status exposes event IDs and reaction metadata rather than raw message text.

Codex's planner runs read-only outside the repository, with configured MCP servers, tools, plugins, hooks and other interactive features disabled. Claude's planner has no built-in tools, external MCP configurations or session persistence. Native inference has a 45-second deadline; generated geometry is bounded to four beats with three primitives per beat and 200–1,500 ms durations. See [geometry limits](swarm-geometry.md).

The optional API backend uses [Responses structured output](https://developers.openai.com/api/docs/guides/structured-outputs), `store: false`, a four-second deadline and the same event budgets:

```dotenv
FISCH_PLANNER_BACKEND=api
FISCH_PLANNER_MODEL=your-structured-output-model
FISCH_PLANNER_URL=https://api.openai.com/v1/responses
OPENAI_API_KEY=your-private-key
```

Keep keys out of chat and Git. Localhost may use HTTP without a key; other endpoints require HTTPS. `FISCH_PLANNER_API_KEY` supplies custom endpoint credentials. OpenAI credentials are never automatically sent to a different hostname.

## Verification

Tests exercise real hook stdin/IPC, config merging, redaction, immediate attention before inference, duplicate/expired/wrong-turn events, stale model rejection, timeout/cancellation, task request caps, a full simulated day of idle with zero inference, preserved geometry and macro-safe settling. `node scripts/interaction-smoke.mjs` explicitly runs signed-in Codex on synthetic praise/frustration fixtures and saves native-renderer images and timing evidence. This consumes provider usage and is not part of ordinary idle operation.

Synthetic hook tests do not certify delivery from a trusted hook in a user's interactive CLI. Live Claude inference and human assessment of contextual emotion remain unverified. Braille has less detail than the reference renderer. The next acceptance check is whether people recognize each expression as an appropriate response to its paired message, not simply whether model output compiled.
