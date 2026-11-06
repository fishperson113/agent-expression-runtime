# Pane runtime and browser reference

The normal entry point is `fisch run` in a free Herdr pane next to an existing Codex or Claude. It runs the expression engine and particle renderer in Node and attaches through Herdr discovery and a private local socket. It does not launch a browser or another agent. See [the pane guide](multiplexer.md).

## Requirements

Node.js 22.12+ (or 24), npm and Herdr with its local socket API enabled. The agent must already be running and capable of shell commands. Missing checkout dependencies are installed with `npm ci`. Link the checkout once using `npm link` to expose the `fisch` command.

The launcher uses platform-native sockets and has no PowerShell dependency. Windows live attachment has been exercised with Codex. Claude discovery is covered by automated tests; live Claude attachment remains unverified. The new pane path still needs a live Linux/macOS multiplexer check; earlier Linux build validation covers the reference engine.

## Display and lifecycle

Inline RGB requires Herdr graphics support and cell dimensions. If experimental graphics are disabled, Fisch enables `experimental.kitty_graphics` in the existing Herdr configuration and reloads it without restarting agents. If pixels remain unavailable, colored Braille particles stay inside the pane. This is a lower fidelity display, not evidence that subtle effort differences are perceptible.

Each agent pane has a separate private control endpoint. Fisch refuses a second body attached to that same pane. Agent notification is retried if Herdr reports the agent blocked. q, Ctrl+C or `fisch stop` stops the body; the original chat remains. A vanished agent ends the body. A new run starts a fresh macro registry. No model credentials enter the engine.

## Development and evaluation

`npm run dev` and `npm run tauri -- dev` remain browser/desktop developer entry points. `fisch evaluate` opens the separate browser reference evaluation workflow and retains its Rust and browser prerequisites. `fisch build` builds the reference frontend; `fisch test` runs automated checks. These commands are independent of pane attachment.

For custom HTTP/MCP hosts, see [the protocol reference](integration.md). That adapter remains available but is not required by `fisch run`.
