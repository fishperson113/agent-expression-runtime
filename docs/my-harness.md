# Development guardrails

Fisch vendors [my-harness](https://github.com/fishperson113/my-harness) at
commit `b3ca44e1a52e0fd01e06c20fed2e5005c41cda91`. The three files under
`tools/my-harness/` are unmodified upstream copies. Their MIT license covers
only that tooling; Fisch's product licensing remains undecided.

Requires Git and Python 3.8+. No Python packages or model credentials are needed.
Run once from this checkout, using `py -3` instead of `python3` on Windows:

```sh
python3 scripts/setup-harness.py
python3 scripts/check-harness.py
```

Setup preserves other `.git/my-harness.toml` keys and adds `.` to
`docs_extra_dirs`: this repository deliberately has root AGENTS/CLAUDE documents.
That upstream setting also permits other root Markdown documents; nested code
directories remain subject to R4. Defaults remain unchanged for all other rules.
Configuration is local Git metadata, so repeat setup in each fresh checkout.

R1 blocks more than 10 changed files, R3 blocks copy-style new filenames, R4
blocks new Markdown outside established/configured docs directories, R5 blocks
touched functions over 50 lines, and R6 blocks added comment ratios over 30%.
R7 (three commits), R8 (applied exemptions), R9 (400 added lines) and R11 (test
evidence) are reports, not blocking budgets. Do not weaken rules or add `hack:`
exemptions just to get a pass. User-approved larger changes must be explicit.

## Claude Code

The checked-in `.claude/settings.json` adds SessionStart, PreToolUse and Stop
hooks without replacing personal settings, Fisch lifecycle hooks or status lines.
Restart/review project hook trust as required by your client. Python 3.8+ and
Git Bash are required for bundled shell commands on Windows. Avoid installing
the upstream plugin a second time for this project: duplicate hooks run twice.
An optional status line can append `sh tools/my-harness/bin/my-harness status`
to an existing status script; this integration does not install one.

## Codex CLI and local app

```sh
python3 scripts/setup-harness.py --codex
```

This opt-in command merges three hook entries into `~/.codex/hooks.json`,
preserves existing entries and creates a first-install backup when the file
already exists. Repeating it does not duplicate these entries. Commands use the
current Python executable and an absolute checkout path; rerun after moving the
checkout and remove the old entries. They apply only when the hook's Git root
matches this checkout. No local Codex configuration was changed by the Cloud PR.

Restart Codex and review/trust the entries in `/hooks` or Settings > Hooks.
Hooks must be enabled by local/admin configuration. Upstream checked its adapter
against CLI 0.166.0; direct tests do not prove your client invokes trusted hooks.
Codex pre-checks cover documented apply_patch batches; shell/MCP edits are checked
at Stop. Codex R10/R11 transcript verification is unsupported.

## Cloud and CI

Local command hooks do not run under Work Cloud orchestration. AGENTS.md requires
the explicit strict checker before committing/finishing. It uses the upstream
evaluator, exits nonzero for blocking rules and fails on unexpected errors;
upstream's `check` remains an informational, fail-open command.

The separate GitHub workflow checks the committed PR range against its merge
base in a disposable local clone, without resetting the working checkout. Root
docs configuration is applied there too. R10/R11 remain unknown without a client
transcript; CI's tests provide separate evidence. This is a change-budget gate,
not proof of business correctness or native acceptance.

```sh
python3 scripts/check-harness.py --base origin/main
```

For updates, review upstream changes and copy `harness.py`, `bin/my-harness` and
`LICENSE` together, update the pin above, run upstream's unittest suite against
the vendored copies, and check both adapters plus the strict entry point.
Keep README architecture/test commands and the product's known limits intact.
To uninstall, remove only this project's hook entries and restore the previous
local docs setting if desired; preserve unrelated hooks/configuration.
