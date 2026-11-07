# Pane runtime and browser reference

The normal entry point is `fisch run` in a free Herdr pane next to an existing Codex or Claude. It runs the expression engine and particle renderer in Node and attaches through Herdr discovery and a status-event subscription. Its activity hook automatically submits expressions without involving the model. A private local socket remains for diagnostics and stopping. It does not launch a browser or another agent. See [the pane guide](multiplexer.md).

## Requirements

Node.js 22.12+ (or 24), npm and Herdr with its local socket API enabled. The agent must already be running and capable of shell commands. Missing checkout dependencies are installed with `npm ci`. Link the checkout once using `npm link` to expose the `fisch` command.

The launcher uses platform-native sockets and has no PowerShell dependency. Windows live attachment has been exercised with Codex. Claude discovery is covered by automated tests; live Claude attachment remains unverified. The new pane path still needs a live Linux/macOS multiplexer check; earlier Linux build validation covers the reference engine.

## Display and lifecycle

Inline RGB requires Herdr graphics support and cell dimensions. If experimental graphics are disabled, Fisch enables `experimental.kitty_graphics` in the existing Herdr configuration and reloads it without restarting agents. If pixels remain unavailable, colored Braille particles stay inside the pane. This is a lower fidelity display, not evidence that subtle effort differences are perceptible.

Each agent pane has a separate private control endpoint. Fisch refuses a second body attached to that same pane. No attachment prompt is sent. Herdr status events drive the body automatically; a blocked agent changes the activity preset rather than waiting for a tool call. Event subscriptions reconnect automatically. q, Ctrl+C or `fisch stop` stops the body; the original chat remains. A vanished agent ends the body. A new run starts a fresh macro registry. No model credentials enter the engine.

## Development and evaluation

`npm run dev` and `npm run tauri -- dev` remain browser/desktop developer entry points. `fisch evaluate` opens the separate browser reference evaluation workflow and retains its Rust and browser prerequisites. `fisch build` builds the reference frontend; `fisch test` runs automated checks. These commands are independent of pane attachment.

For custom HTTP/MCP hosts, see [the protocol reference](integration.md). That adapter remains available but is not required by `fisch run`.

## Hook scope

This uses the multiplexer’s `pane.agent_status_changed` event hook for Codex and Claude, not native provider hook configuration. It requires no edits to agent settings or hook trust. Native Codex [lifecycle hooks](https://learn.chatgpt.com/docs/hooks) are a separate mechanism requiring review and trust; Fisch does not bypass that mechanism. Status presets visualize activity immediately. A separate background Codex/Claude process adds contextual planning from a bounded terminal excerpt; see [the planner guide](expression-planner.md). API transport is optional.
