# Herdr: one command

Keep Codex or Claude running in one pane. In the neighboring free pane, run:

```sh
fisch run
```

Fisch renders inside that pane and attaches to the existing agent. No browser, new conversation, model API key, clipboard pairing or agent restart is involved. The agent receives instructions automatically and uses shell commands to drive the real expression compiler and scheduler.

Discovery prefers the same tab and working directory within the same workspace. If several agents match equally, Fisch asks for `fisch run --agent <pane-id>` rather than guessing. The renderer pane itself is excluded.

Agent controls (the user only needs the launch command):

```sh
fisch status
fisch capabilities
fisch express '{"type":"morph","target":"wall","durationMs":900}'
fisch cancel
fisch stop
```

`express` accepts an AST or an envelope containing `body`, `kind`, `track`, `policy` and `ttlMs`. `cancel` cancels motion and resets posture; it does not select a new shape. `stop`, q or Ctrl+C closes the body and its private local control socket. The existing agent keeps running. If the agent disappears, Fisch exits. Restarting Fisch starts a fresh engine; definitions must be sent again.

Herdr clients with inline RGB support display projected particles. Otherwise Fisch uses colored Braille in the terminal, with lower detail and a fixed display color. This fallback uses the same geometry and scheduler but is unsuitable for judging subtle color or effort differences. The installed preview currently reports unavailable cell dimensions, so it uses Braille. No browser fallback is opened.

See [runtime requirements](browser-and-hosts.md) and `fisch doctor` for attachment diagnostics.
