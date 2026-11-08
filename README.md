# Fisch

A visible particle body for your coding agent.

Fisch turns agent activity into motion and lets Codex create expressions and illustrations with particles. It runs locally in a browser or a Herdr panel.

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
npm ci
npm link
fisch build
```

Then, in a normal terminal:

```sh
fisch live
```

This opens the particle face in a browser and Codex in your terminal. In Herdr, it uses an optional dedicated pane. Click **Bật camera** when you want local face tracking; the camera starts off. Real camera images stay on your machine. Talk to Codex normally.

Prefer the terminal body? Keep Codex or Claude open in a neighboring Herdr pane and run:

```sh
fisch run
```

## Learn more

- [Live guide](docs/fisch-live.md) - camera, controls and privacy
- [Panel guide](docs/multiplexer.md) - terminal workflow
- [Contributing](docs/my-harness.md) - development and checks
- [Architecture](docs/architecture.md) | [Validation](docs/validation.md) - technical details and POC limits

## Community and license

Issues and pull requests are welcome. Please follow the [Code of Conduct](docs/CODE_OF_CONDUCT.md).

Fisch is [MIT licensed](LICENSE). Third-party components retain their [own licenses](docs/dependency-licenses.md).
