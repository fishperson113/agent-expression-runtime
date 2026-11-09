# Codex folder trust on Cloud

The Cloud TUI gate was exercised on CLI 0.167.0-alpha.4 without granting folder
trust. A real remote TUI completed one short signed-in model turn with Fisch MCP:
working/replying, expression admission/application and submitted-frame change
proxies all occurred. Camera stayed off. The session sent zero configuration-write
requests, the home user-config SHA stayed unchanged, and no project-trust entry
or home hooks file was persisted. Budget reservations reached 53/120, including
one unsuccessful startup attempt; this is separate from the frozen holdout.

## What accepting the dialog means

Accepting “Trust this folder?” persists a trusted project entry in Codex user
configuration and permits that project's `.codex/` configuration layer. Project
configuration can affect agent settings and provide rules/hooks. Hook execution
has its own review/trust mechanism; folder trust does not by itself certify or
approve every hook. Approval policy and sandbox are separate controls. Trust
alone does not change Cloud network policy, OS permissions or OAuth scope.
Project configuration cannot supply protected authentication/provider/telemetry
settings. These distinctions follow the official
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference),
[configuration layers](https://learn.chatgpt.com/docs/config-file/config-advanced),
[hooks](https://learn.chatgpt.com/docs/hooks) and
[security guide](https://learn.chatgpt.com/docs/agent-approvals-security).
The relevant upstream dialog implementation is visible in
[Codex PR 39082](https://github.com/openai/codex/pull/39082/files).

## Repository and local audit

This checkout has no `.codex/` directory or tracked Codex configuration, rules or
hooks. `.claude/settings.json` invokes the pinned my-harness session/pre/stop
commands for Claude; `CLAUDE.md` imports `AGENTS.md`. These are not Codex hooks.
`scripts/setup-harness.py --codex` is an explicit optional installer for home
SessionStart/PreToolUse/Stop hooks, preserving existing entries with backup; it
was not run. Cloud validation continues to invoke strict my-harness explicitly.

Inspected user configuration had no project-trust entry or inline hooks, and no
home hooks file existed. `/workspace/.codex/config.toml` and `hooks.json` were
absent. System configuration provides plugins/marketplaces; no inline hooks or
requirements file was found. This is an audit of those files, not a claim that
all plugin behavior or future repository revisions were audited. No credential
values or full configuration contents are included in evidence.

## Restrictive test alternative

Official CLI help supports invocation-only `-c` overrides, read-only sandbox and
on-request approvals. On the tested version, the remote app-server was launched
with the following additional configuration arguments:

```sh
-c 'projects={"/workspace/agent-expression-runtime"={trust_level="untrusted"}}' \
-c 'sandbox_mode="read-only"' -c 'approval_policy="on-request"'
```

The TUI used `--sandbox read-only --ask-for-approval on-request`.
The workspace/cwd supplied to both components must be the same normalized path,
without a trailing slash. An initial trailing-slash mismatch stopped at startup
without model inference; it did not grant trust. Effective configuration was
read back as untrusted/read-only/on-request with session-only overrides. No
`config/batchWrite` or other configuration mutation was allowed by the probe.
This tests the existing remote TUI/Fisch integration; it does not change the
launcher's defaults or certify native hook delivery. Default undecided startup
can still ask for trust. Persistently trusting a folder remains a separate owner
action, unnecessary for this bounded restrictive test.
