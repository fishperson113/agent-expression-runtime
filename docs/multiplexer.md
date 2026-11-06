# Terminal multiplexer control

The host integration is ordinary HTTP/MCP and does not depend on Herdr. Use any terminal pane that can run Node and connect to IPv4 loopback. A terminal pane displays textual receipts; this is not an embedded WebGL surface. The particle body currently lives in the Tauri window (or the browser sandbox).

Start the desktop app separately and obtain the loopback address and pairing token from its pairing panel. Set `AER_BASE_URL` and `AER_PAIRING_TOKEN` in the controlling process environment, never in model instructions or committed configuration. Then run:

```sh
node integrations/cli.mjs capabilities
node integrations/cli.mjs smoke
```

`smoke` acquires a controller, submits a one-second sphere morph, prints admission latency/status, cancels and releases the controller with `DELETE /v1/sessions/{id}`. It does not certify frame timing or visual correctness. It deliberately fails if another controller is active; it never takes over that controller. Release the previous controller in its own host or in the desktop UI.

For Codex/Claude hosts, the transport remains the MCP stdio program described in [integration](integration.md). Host-specific registration commands must be checked against the installed host/version before configuration. No host configuration or lasting credentials have been installed by this work.

Verified locally: `herdr --help` describes a terminal workspace manager; `herdr pane --help` exposes run/read/send-text and `herdr api --help` exposes snapshot/schema. `herdr status server` reported not running. No pane was created, no existing pane was altered and no graphical embedding capability was verified. The CLI is not Herdr-specific.
