# Pane runtime and browser reference

Implementation baseline: `9863ba3` (2026-11-07).

The default entry point is `fisch run` in a free Herdr pane beside an existing Codex or Claude. Node runs the particle engine and renderer, discovers the existing agent and subscribes to lifecycle status. No browser or new interactive agent opens; the main agent receives no injected prompt and calls no Fisch tool. See [pane controls](multiplexer.md).

## Requirements

Node.js 22.12+ (or 24), npm and Herdr with its local socket API enabled. Link the checkout once with `npm link`. Missing dependencies are installed with `npm ci`. The launcher uses platform-native sockets and has no PowerShell dependency. Windows Codex attachment has recorded live evidence. Interactive Claude-in-Herdr and live Linux/macOS pane delivery remain unverified; earlier Linux build/smoke results have narrower scope.

## Display and lifecycle

Inline RGB requires Herdr graphics support and cell dimensions. Otherwise colored Braille remains inside the pane. Launch reads Herdr settings without changing them or reloading Herdr. Adaptive Braille is the default; `FISCH_BRAILLE_STYLE=peak` in the launching shell selects the earlier area-peak style. Braille has lower fidelity than the reference renderer; subtle effort perception remains unverified.

Each agent pane has a private control endpoint and at most one attached body. Event subscriptions reconnect. q, Ctrl+C or `fisch stop` closes Fisch while leaving the agent running; a vanished agent ends the body. Restart resets macros and prepared scenes.

## Interaction and local presence

Herdr status events supply activity. Actual user-message and recognized task events come from explicitly installed native provider hooks: `fisch hooks install codex` or `fisch hooks install claude`. Codex additionally requires review/trust in `/hooks`. Launch itself never edits provider settings. Installation alone does not prove delivery; inspect `fisch status` or `fisch doctor`.

Immediate local attention precedes contextual inference in a separate noninteractive provider process using existing CLI authentication, or the optional API backend. Fisch does not read terminal excerpts for planning. The engine requires no model account; inference consumes provider usage. Set `FISCH_PLANNER_BACKEND=off` to disable it.

Local presence, validated part performances and prepared idle scenes run without idle inference. Scenes can change the full form and show short in-pane captions; they are finite, memory-only content prepared during an interaction. There are no sounds or external notifications. See [planner budgets, privacy and configuration](expression-planner.md).

## Development and evaluation

`npm run dev` and `npm run tauri -- dev` are browser/desktop development entry points. `fisch evaluate` opens a separate browser reference evaluation workflow with its Rust/browser prerequisites. `fisch build` and `fisch test` are independent of pane attachment. Custom hosts can use the [HTTP/MCP protocol](integration.md).
