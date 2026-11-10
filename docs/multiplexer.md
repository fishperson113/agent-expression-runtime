# Herdr and terminal-panel migration

## Normal use

Run `fisch live` in a free shell pane, including inside Herdr, tmux or another multiplexer. Codex runs in that same terminal and the body opens in a browser. No Herdr API, neighboring agent, global hooks or pane ID is needed. Run from the project directory you want Codex to use.

The old `fisch run` terminal body has been removed. `npm start` now launches Live from the checkout. The old terminal-only `fisch express` and `fisch cancel` commands are also removed; they fail with migration guidance rather than silently launching another session. Codex still has the Live MCP `express` and `cancel_expression` tools. Use the browser controls to stop an expression or end a normal Live session.

Live starts a new Codex process with temporary MCP settings. It does not attach tools to an already-running Codex or Claude process. Existing sessions stay untouched. See [Live setup, controls and privacy](fisch-live.md).

## Explicit Herdr adapter

The optional adapter remains available for a known Codex source pane:

```sh
fisch live --agent <pane-id>
```

This requires a working Herdr local socket API. It selects the source pane's workspace and creates a dedicated Codex pane with temporary MCP settings, while the body still renders in the browser. It does not restore the removed RGB/Braille terminal renderer. Ordinary `fisch live` does not create a separate pane automatically.

Run these diagnostics from that dedicated Live Codex pane, whose `HERDR_PANE_ID` identifies the private endpoint:

```sh
fisch status
fisch stop
```

`status` reports `status: live`, synthetic-only look mode and the number of delivered hook events. It does not expose the retired planner, Braille or idle-scene metrics. `stop` ends Live's gateway/browser resources; Herdr owns the separate pane lifecycle. For normal-terminal Live, use its browser controls or exit Codex instead. Camera-triggered provider reactions are unavailable in the explicit adapter; local camera reflexes and native observe/express tools remain available.

## Optional hooks and cleanup

Normal-terminal Live does not require global hooks. Existing trusted Codex hooks can forward supported event types to the explicit Herdr adapter; no raw prompt context is injected into Live. Hook delivery is optional and installation alone does not establish trust or delivery.

To inspect or remove Fisch hooks installed for the old panel:

```sh
fisch hooks status
fisch hooks uninstall
# Or remove one provider only:
fisch hooks uninstall codex
fisch hooks uninstall claude
```

Uninstall removes only Fisch entries and preserves unrelated hooks/settings. Closing a session does not uninstall hooks. If explicitly adding optional hooks, `fisch hooks install codex` still requires native review/trust in Codex `/hooks`; Fisch does not bypass trust or change it automatically. Claude hook management remains for existing integrations and cleanup, not a supported Claude Live launcher.

`fisch doctor` checks local Node/Rust/Codex/browser/dependency prerequisites, not pane attachment, login, hook trust or actual event delivery. The [historical planner reference](expression-planner.md) records the retired panel behavior and retained test fixtures, not current launch instructions.
