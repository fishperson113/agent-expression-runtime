# Browser display and Codex in one command

Link this checkout once with `npm link`. In a free Herdr/terminal pane, run:

```powershell
fisch run
```

The Node launcher installs missing npm dependencies, validates/builds the frontend, incrementally builds the Rust gateway, opens a dedicated browser window and automatically pairs its renderer. It then starts a fresh Codex CLI session in that same terminal pane with the existing `aer` MCP adapter already configured. The other pane and existing conversation stay available.

There is no clipboard step, token input, manual environment setup or edit to `~/.codex/config.toml`. The first Codex prompt loads `aer://instructions/v1` and requests a short sphere expression. Model replies remain in the terminal; the browser displays the particle body. The browser's conversation form is a separate scripted demo.

Commands: `fisch run` starts a connected session; `fisch build` builds without a model; `fisch test` runs automated checks; `fisch evaluate` opens the blind observer workflow; `fisch doctor` checks prerequisites; `fisch --help` lists commands.

## Requirements

Windows, Linux or macOS; Node.js 22.12+ (or 24), npm, Rust stable, platform Tauri build prerequisites, an installed Microsoft Edge or Google Chrome, and Codex CLI already signed in. Windows needs Microsoft C++ Build Tools; Linux needs GTK/WebKit development packages; macOS needs Xcode command line tools. PowerShell is not required by `fisch run`. The launcher also supports a locally installed Playwright Chromium as a fallback, or a browser executable selected with `CHROME_PATH`. It does not install system toolchains, download browsers, change Codex authentication or configure paid services.

## Session lifetime

Exit Codex or close the particle window to stop the session. The launcher closes its browser and stops its gateway/frontend and child host processes. Ctrl+C also requests shutdown. A forced termination of the launcher or OS crash cannot guarantee cleanup.

Each run selects available loopback ports and creates a new random credential. The credential travels through child-process environments and the browser's in-memory password input, which is cleared after pairing. It is not put in URLs, shell arguments, clipboard, configuration files or launcher logs. Browser refresh is paired again automatically using the launcher-held credential; the MCP host recreates its session and restores acknowledged macros on the next command. Closing the window ends the launcher session.

Codex runs with `--no-daemon` so this invocation receives its own inherited environment rather than sharing a daemon started without the credential. MCP options apply only to this invocation; the launcher does not weaken sandbox or approval settings. The new session is independent of the chat already open in another Herdr pane.

The first model-selected expression still depends on Codex login, model availability and host/tool approval settings. The launcher verifies renderer readiness before starting Codex; this does not certify a model response or physical display timing. See [admission semantics](admission.md).

## Development and protocol reference

`npm run dev` and `npm run tauri -- dev` remain developer entry points. For custom agent hosts, see [the HTTP/MCP protocol](integration.md). These are implementation references, not additional setup steps for `fisch run`.
