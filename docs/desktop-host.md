# Codex Desktop capability host

This mode gives an existing Codex Desktop agent access to Fisch's expression engine. It does not launch a private Codex TUI, start an observer model, project Desktop transcripts, or provide speech recognition. Existing `fisch live` retains its default proactive behavior.

1. Run `fisch desktop --mcp-config` and review the printed `[mcp_servers.fisch]` configuration. Add it using Codex's supported MCP configuration workflow; Fisch does not edit application configuration or folder trust.
2. Run `fisch desktop` in a terminal. This prepares the normal Live browser and loopback gateway. Keep it running.
3. Connect the configured MCP server from Codex Desktop. Its `fisch mcp` process connects only to the already-running body; it never bootstraps or reopens the browser.

The MCP launcher requires host-provided thread binding before mutation (`FISCH_MCP_REQUIRE_THREAD=1`). The binding contract must be installed alongside this host. A shared session identifier is not a conversation identifier. Desktop dictation must submit into the actual connected conversation; this increment does not establish that workflow or claim Windows microphone acceptance.

## Runtime capability and lifecycle

The host keeps an ephemeral loopback pairing capability in `fisch/desktop-live` under the OS user-data directory (Linux XDG data/home fallback, macOS Application Support, Windows LocalAppData). This is an engine-local token, not Codex authentication. Unlike the memory-only Tauri pairing path, this CLI handoff uses a private runtime file so separately started MCP children can connect. It is passed to the server only in its child environment, never printed or included in configuration.

On POSIX, the runtime directory/lock are owner-private mode 0700 and files 0600; ownership, file types and symlinks are checked. Windows uses the user's standard data location; POSIX mode checks do not establish Windows ACL isolation. No Windows hardware or Desktop integration acceptance is implied.

An exclusive lock prevents another host from taking over. Missing host fails `desktop_host_not_running`; malformed, unsafe or unowned state fails closed. Abnormal exits may leave a lock: inspect the owning process before manually removing stale state. There is no automatic takeover, ledger reset or credential migration.

Closing the browser, pressing its Stop control, or stopping the host closes the gateway and removes only that instance's runtime record. MCP EOF/signals close the child server. Stopping the body does not claim to cancel inference already running inside Codex Desktop. A later MCP invocation cannot restart a stopped host.

## Validation boundary

Unit tests cover private registry ownership, corruption, symlinks, no-clobber publication, process liveness, host cleanup and raw stdio forwarding. CLI tests cover static configuration and missing-host failure without dependency/bootstrap output. Actual Desktop discovery, host thread metadata, user-reviewed configuration and end-to-end expression rendering require separate integration acceptance. No camera, microphone or model invocation is necessary for these unit checks.
