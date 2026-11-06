# Browser display, terminal control

The simple POC path uses a browser for WebGL and any terminal multiplexer for the gateway and agent. It does not render 3D inside the terminal pane and does not depend on Herdr. The Rust gateway can run without a Tauri window; it still binds loopback and requires pairing authentication.

## Quick Windows run

From the repository root, run `npm ci`, then:

```powershell
pwsh -File scripts/start-browser.ps1 -CopyToken
```

The launcher builds the current gateway, generates an ephemeral credential, starts the gateway hidden and starts Vite in the foreground. Open the printed browser URL. Enter the printed gateway URL, paste the clipboard token into the password field and click **Connect browser renderer**. The input is cleared after connection. No token is printed or written to the runtime info file; that file contains only the loopback address. Ctrl+C stops the launcher gateway. Use `-Port 5180` if needed; the Origin allowlist follows that exact port.

Only one renderer/controller is supported. Connecting a new renderer releases the prior session. A local scripted demo cannot take over an active external controller; release it explicitly first. Disabling Expressions cancels body work without revoking the host session. Browser refresh creates a fresh compiler session, so the host must reconnect and redefine macros.

## Control from another pane

Set `AER_BASE_URL` to the gateway URL and `AER_PAIRING_TOKEN` to the same ephemeral credential in the agent host's process environment. Separately created multiplexer panes do not automatically inherit variables set later in another pane. In a PowerShell host pane you can assign `$env:AER_PAIRING_TOKEN = Get-Clipboard` after the launcher copied it, without printing or placing the value in a command literal. Do not save the token in shell profiles, committed files or model instructions.

```sh
node integrations/cli.mjs capabilities
node integrations/cli.mjs smoke
```

The smoke command acquires a controller, submits, cancels and releases it. It fails rather than stealing an active controller. The browser displays the body; the pane displays text receipts. To test the complete automated path with Chromium installed:

```sh
cargo build --locked --manifest-path src-tauri/Cargo.toml
node scripts/browser-bridge-smoke.mjs
```

`CHROME_PATH` can select an existing Chromium. This test starts its own gateway/Vite/browser processes, uses a temporary in-memory credential and writes only non-secret results to `docs/evidence/browser-bridge-smoke.json`.

## Codex

The installed `codex mcp add --help` supports local stdio commands. For manual registration, use `codex mcp add aer -- node "ABSOLUTE_REPO_PATH/integrations/mcp-server.mjs"`, then configure only environment-variable **names**, not credential values:

```toml
[mcp_servers.aer]
command = "node"
args = ["ABSOLUTE_REPO_PATH/integrations/mcp-server.mjs"]
env_vars = ["AER_BASE_URL", "AER_PAIRING_TOKEN"]
```

Merge this into the appropriate Codex configuration rather than duplicating an existing server table. Start the host from a process that has those ephemeral environment variables. Review/trust the server through the host's normal controls. See [official Codex MCP documentation](https://developers.openai.com/codex/mcp). Registration/configuration was not performed by this work.

## Claude Code

The installed CLI supports `--mcp-config`. Set `AER_REPO_DIR`, `AER_BASE_URL` and `AER_PAIRING_TOKEN` in the launching process, then use the example that contains environment references rather than literal secrets:

```sh
claude --mcp-config integrations/claude-mcp.example.json
```

Check `/mcp` in that host, approve the local server if requested and load `aer://instructions/v1` into agent context. The example uses documented environment expansion in MCP configuration. See [official Claude Code MCP documentation](https://code.claude.com/docs/en/mcp). This verifies configuration syntax and the fake-host protocol, not a real model/host behavioral benchmark. No Claude configuration or credential has been installed.

For either host, request a short `express` program and continue the normal answer independently. ACK means admission, `pending` means unconfirmed, and animation completion is separate feedback. Standard sequential tool-calling may pause text; this runtime cannot remove that host limitation. No evaluator is included.
