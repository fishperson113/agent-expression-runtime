# Live runtime and reference hosts

## Default workflow

`fisch live` prepares the checkout-local dependencies, standalone browser gateway and frontend, then opens a browser body and Codex in the launching terminal. Herdr is optional. The workspace is the directory where you run the command, not necessarily the Fisch checkout. `npm start` is the equivalent when launched from that checkout.

The old `fisch run` terminal renderer and terminal-only `express`/`cancel` CLI controls have been removed. Use [the migration guide](multiplexer.md) for existing installations. Live does not hot-attach to an already-running agent and does not launch the old secondary expression planner.

## Requirements and setup

- Node.js 22.12+ and npm.
- Rust stable with the platform compiler/linker prerequisites. The standalone Live gateway does not require Tauri's desktop GTK/WebKit dependencies.
- Edge, Chrome or Playwright Chromium (`npx playwright install chromium`). `CHROME_PATH` can select a browser executable.
- A compatible Codex CLI with app-server/remote support, already signed in.

Run `npm link` once in the Fisch checkout, then `fisch live` from your project. First launch can download locked npm dependencies, Cargo crates and checksum-verified face assets; later launches reuse unchanged builds. `--hands` also prepares the hand model. `--no-assets` skips vision downloads, not existing local assets. Asset preparation never enables the camera. See [the Live guide](fisch-live.md) and [Windows checks](live-windows-qa.md).

`fisch doctor` inspects installed prerequisites without changing settings. It does not certify Codex login/protocol support, compiler linking, camera permission, GPU performance or hook delivery.

## Lifecycle, privacy and optional Herdr

Camera and automatic camera reactions start off. Codex uses transient MCP configuration; tokens stay in inherited environment and authenticated local transport, never command arguments or URLs. Live does not install hooks or rewrite global Codex/Herdr settings.

Exit Codex, close the body, use the browser's stop control or interrupt the launcher to close the owned normal-terminal session. Unrelated agents stay running. Starting again creates fresh pairing/session credentials. The explicit `fisch live --agent <pane-id>` adapter creates a dedicated Herdr Codex pane; its private `status`/`stop` controls and ownership limits are documented [separately](multiplexer.md#explicit-herdr-adapter).

## Development and evaluation

`npm run dev` and `npm run tauri -- dev` remain the browser sandbox and native desktop development entry points. The latter requires the additional platform Tauri prerequisites. `fisch evaluate` opens the model-free browser reference A/B workflow; it is not Live and does not need a Codex login. `fisch build` builds the frontend and standalone gateway; `fisch test` also runs the automated checks, including default-feature Rust tests with desktop prerequisites. `fisch capabilities` prints the base expression contract without starting a session.

The retained terminal engine, planner and Braille helpers support historical reference tests and explicit research scripts; no supported CLI launches the terminal panel. Custom hosts may still use the [HTTP/MCP protocol](integration.md). The core compiler/scheduler and admission/authentication guarantees are unchanged. See [development checks](my-harness.md) and [validation limits](validation.md); deterministic fixtures do not establish native/GPU or human-semantic acceptance.
