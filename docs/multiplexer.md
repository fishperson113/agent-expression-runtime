# Herdr: one command

Link the checkout once with `npm link`. Keep the current chat in one pane. In the other pane, from the repository root, run:

```powershell
fisch run
```

This opens the particle body in a browser and starts a fresh Codex session in the pane running the command. Pairing and MCP configuration happen automatically. No Herdr pane IDs, socket API, clipboard token or global Codex configuration are needed.

Talk to the new Codex session to drive expressions. The existing chat is independent and is not hot-attached. Exit the new Codex session or close the particle window to stop the runtime and its child processes.

Herdr displays text; WebGL appears in the browser window. The launcher also works in an ordinary PowerShell terminal. See [requirements and lifecycle](browser-and-hosts.md).
