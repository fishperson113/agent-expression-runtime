# Herdr: one command

Keep Codex or Claude running in one pane. In the neighboring free pane, run:

```sh
fisch run
```

Fisch renders inside that pane and automatically subscribes to Herdr lifecycle events for the existing agent. The default path is:

`agent activity → Herdr status event → Fisch activity hook → expression engine → pane`

The model does not call a tool, run `fisch express`, receive attachment prompts, or choose these expressions. There is no browser, new conversation, model API key or agent restart. The hook receives status metadata only; Fisch does not read chat text or transcripts.

Working selects cloud/orbit, blocked selects wall/pulse, done selects sphere/pulse, and idle selects a quiet sphere/orbit. These are editable activity presets in `integrations/agent-hooks.mjs`, not inferred emotions or semantic reactions to the conversation. Repeated statuses do not restart a morph. The event socket reconnects with bounded backoff; periodic snapshots reconcile missed state changes.

Discovery prefers the same tab and working directory within the same workspace. If several agents match equally, Fisch asks for `fisch run --agent <pane-id>` rather than guessing. The renderer pane itself is excluded.

Optional diagnostic/manual controls (automatic activity requires only the launch command):

```sh
fisch status
fisch capabilities
fisch express '{"type":"morph","target":"wall","durationMs":900}'
fisch cancel
fisch stop
```

`express` accepts an AST or an envelope containing `body`, `kind`, `track`, `policy` and `ttlMs`. `cancel` cancels motion and resets posture; it does not select a new shape. `stop`, q or Ctrl+C closes the body and its private local control socket. The existing agent keeps running. A later activity change replaces a manual diagnostic expression. If the agent disappears, Fisch exits. Restarting Fisch starts a fresh engine; definitions must be sent again.

Herdr clients with inline RGB support display projected particles. Otherwise Fisch uses colored Braille in the terminal, with lower detail and a fixed display color. This fallback uses the same geometry and scheduler but is unsuitable for judging subtle color or effort differences. The installed preview currently reports unavailable cell dimensions, so it uses Braille. No browser fallback is opened.

See [runtime requirements](browser-and-hosts.md) and `fisch doctor` for attachment diagnostics.
