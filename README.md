# Fisch

A visible particle body for your coding agent.

Fisch turns agent activity into motion and lets Codex create expressions and illustrations with particles. It runs locally in a browser, with Codex in your terminal.

## Why Fisch?

Working with an agent often means staring at scrolling text. Fisch explores a quieter, more expressive way to see what your agent is doing and give it a presence beside the conversation.

## Prerequisites

For the browser POC:

- Node.js 22.12+ and npm
- Rust stable and its platform compiler prerequisites
- Chromium (`npx playwright install chromium` once), or Edge on Windows
- Codex CLI with app-server/remote support, already signed in

Herdr is optional for Live. The native Tauri app has additional platform prerequisites.

## Quick start

Install once:

```sh
git clone https://github.com/fishperson113/agent-expression-runtime.git
cd agent-expression-runtime
npm link
```

Then, in a normal terminal:

```sh
fisch live
```

On first launch, Fisch installs locked project dependencies, builds the browser gateway and frontend, and downloads checksum-verified face assets. Later launches reuse unchanged builds. No global tools or settings are installed. Rust/compiler, Edge/Chrome (or Playwright Chromium) and signed-in Codex must already be available.

Use `fisch live --hands` to also prepare the optional hand model, or `fisch live --no-assets` to skip vision downloads. Camera and hand tracking still require explicit browser controls. If a model download fails, Live continues camera-off and retries next launch.

This opens the particle face in a browser and Codex in your terminal. Inside Herdr or another multiplexer, Codex runs in the pane where you launched Live. The explicit `--agent <pane>` legacy adapter remains available. Click **Bật camera** when you want local face tracking; the camera starts off. Real camera images stay on your machine. Talk to Codex normally.

`npm start` is the checkout-local equivalent of `fisch live`; pass options with `npm start -- --hands`.

### Migrating from the terminal panel

The old `fisch run` terminal-body launcher and its `express`/`cancel` CLI controls have been removed. Start `fisch live` from your project directory instead. It opens a new Codex session in that terminal; it does not attach to an already-running agent. Live's MCP `express`/`cancel_expression` tools remain available to Codex.

Use the Live browser controls for normal sessions. `fisch status` and `fisch stop` remain only for the dedicated Herdr pane created by the explicit `fisch live --agent <pane-id>` adapter. Normal-terminal Live needs no global hooks. To remove old hooks you installed, use `fisch hooks uninstall [codex|claude]`; this preserves unrelated provider hooks.

## Learn more

- [Live guide](docs/fisch-live.md) - camera, controls and privacy
- [Herdr guide](docs/multiplexer.md) - optional adapter and panel migration
- [Contributing](docs/my-harness.md) - development and checks
- [Architecture](docs/architecture.md) | [Validation](docs/validation.md) - technical details and POC limits

## Community and license

Issues and pull requests are welcome. Please follow the [Code of Conduct](docs/CODE_OF_CONDUCT.md).

Fisch is [MIT licensed](LICENSE). Third-party components retain their [own licenses](docs/dependency-licenses.md).
