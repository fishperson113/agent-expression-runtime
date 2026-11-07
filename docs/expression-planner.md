# Contextual expression planner

Run `fisch run` beside your existing Codex or Claude pane. Fisch keeps immediate status reflexes and runs a separate, noninteractive planner process for context-sensitive expressions. The original agent receives no prompt or tool instruction. No browser or interactive agent window is opened.

Default backend selection follows the attached agent: `codex exec` or `claude -p`. It uses the CLI's existing authentication, with no separate API key required. This is a new background inference process, not access to the main agent's hidden reasoning or reuse of its in-memory conversation. It consumes provider usage under the CLI account and can incur charges according to that account's plan.

## Data and timing

Fisch reads up to 32 recent unwrapped terminal lines from the selected agent pane, clips the cleaned excerpt to 6,000 characters, and includes the current activity status. It does not read transcript files or another pane. Common credential patterns are redacted, but arbitrary terminal output can still contain sensitive data. Context is sent through process stdin, not command arguments, and is not written by Fisch to logs or conversation files. CLI/provider behavior and retention policies still apply.

Context is sampled at most every two seconds. Unchanged context creates no model call. Native planning also waits for a two-second quiet context window; changing terminal clocks are filtered. Native planner requests are spaced at least 30 seconds apart and time out after 20 seconds. The visible body continues rendering while inference runs. A status or captured context change aborts obsolete in-flight inference and queues the latest context; stale results cannot overwrite the current expression. Ordinary terminal text updates do not reset an already admitted plan. A real agent status change still cancels its motion and applies the new status reflex immediately. Completion of a plan does not force another model request.

The model returns a bounded JSON expression: at most four sequential beats, each containing up to three parallel morph/flow/shape-quality primitives. Beat durations are 200–1,500 ms. Shapes and fields come from the shared capability manifest. A small planner guard and the existing compiler validate the result before admission. Invalid JSON, conflicting properties, refusal, missing CLI/login and timeouts preserve the reflex layer. Plans illustrate communicative context, not evidence of private emotions.

## Configuration

No configuration is needed for native CLI planning. Optional settings are read from the checkout's ignored `.env` file, with environment variables taking precedence:

```dotenv
FISCH_PLANNER_BACKEND=codex
# Alternatives: claude, api, off
# Optional model override; otherwise the CLI selects its default model.
# FISCH_PLANNER_MODEL=your-model
# Optional executable or JavaScript CLI path, without shell arguments.
# FISCH_PLANNER_COMMAND=/absolute/path/to/codex
```

`fisch status` includes planner backend, mode, attempts, applied plans, stale results discarded, a sanitized error code, the last admitted AST and its admission timestamp. The pane header and `bodySource` show whether the last automatic body program came from `reflex` or `planner`; admission is not a claim about how long it remained visible. `off` keeps automatic status reflexes without reading terminal context or starting an inference process. API credentials alone never switch the backend to API.

Native Codex runs ephemeral, outside the repository in a temporary scratch directory, with user configuration ignored but its normal authentication retained. It uses read-only sandboxing and disables shell, apps, plugins, hooks, multi-agent, browser/computer and image features. It does not inherit custom user model providers from `config.toml`. Claude runs without built-in tools, external MCP configurations or session persistence and does not load settings sources. Neither path relaxes approvals or edits the main agent's configuration. These flags require compatible recent CLI versions; unsupported versions fall back to status reflexes.

## Optional API backend

```dotenv
FISCH_PLANNER_BACKEND=api
FISCH_PLANNER_MODEL=your-structured-output-model
FISCH_PLANNER_URL=https://api.openai.com/v1/responses
OPENAI_API_KEY=your-private-key
```

Keep keys out of chat and Git. The optional transport uses the [Responses structured-output format](https://developers.openai.com/api/docs/guides/structured-outputs), with `store: false`. A compatible local Responses endpoint may use HTTP on localhost and omit a key. Other endpoints require HTTPS. `FISCH_PLANNER_API_KEY` supplies credentials for a custom endpoint; the OpenAI key is never automatically forwarded to another hostname. API requests have a four-second deadline and ten-second minimum spacing.

## Verification and limits

Automated tests cover context throttling/redaction, stale-result rejection after status or context changes, timeouts, invalid plans, real child-process stdin/cancellation, CLI flags and bounded HTTP responses. A live signed-in Codex process returned a three-beat plan accepted by the compiler in about 14 seconds. Live Claude inference and human assessment of contextual expressiveness remain unverified. Terminal context is lossy and includes tool output; this first implementation does not provide typed user-message or work-phase events. Braille also cannot establish subtle perceptual differences.
