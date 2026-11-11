# Native dictation interoperability boundary

This is a source audit and model-free contract test plan, not a working Windows
Dictate integration. Fisch does not record audio, add an STT/TTS engine or resend
a Native transcript. Existing text input remains available.

## Supported pieces and the missing connection

Codex Desktop documents [Dictate into its composer](https://learn.chatgpt.com/docs/prompting#use-voice-dictation)
for review before sending and [standard STDIO/HTTP MCP setup](https://developers.openai.com/codex/mcp).
That supports a candidate in which Desktop owns conversation/dictation and Fisch
is its expression capability. Shared MCP configuration does not attach Desktop
to the private app-server/TUI launched by `fisch live`.

The installed CLI audited here is `0.167.0-alpha.4`, source commit
`fb036d4ebd89f263d34a1f888c279ce85bb383c6`. Its `in_app_dictation` flag is a
[desktop-app permission gate](https://github.com/openai/codex/blob/fb036d4ebd89f263d34a1f888c279ce85bb383c6/codex-rs/features/src/lib.rs#L341),
not evidence of a TUI Dictate control. The TUI's
[voice signaling selects audio output](https://github.com/openai/codex/blob/fb036d4ebd89f263d34a1f888c279ce85bb383c6/codex-rs/tui/src/app_server_session/realtime.rs#L43).
Do not substitute that live-conversation path for the requested record/send
STT-only interaction. No standalone dictation request was found in this version's
generated experimental schema; this does not establish absence in every Native
surface or future version. The actual Windows surface remains uninspected.

## Three different identities

- A Native chat has a `threadId`. Codex adds host routing context to MCP
  [outside model arguments](https://github.com/openai/codex/blob/fb036d4ebd89f263d34a1f888c279ce85bb383c6/codex-rs/core/src/mcp_tool_call.rs#L572).
- Native `_meta.sessionId` can group the root and descendant threads;
  [it is not one chat](https://github.com/openai/codex/blob/fb036d4ebd89f263d34a1f888c279ce85bb383c6/codex-rs/core/src/session/session.rs#L706).
- A Fisch controller has a separate authenticated gateway session and epoch.
  Current MCP retains that controller per process and does not enforce Native
  `_meta.threadId` ownership. Routing metadata is not authentication.

Fisch advertises MCP `2025-06-18`. The pinned Native
[pool implementation](https://github.com/openai/codex/blob/fb036d4ebd89f263d34a1f888c279ce85bb383c6/codex-rs/codex-mcp/src/connection_pool.rs#L1)
keeps legacy connections private; newer compatible connections may be pooled.
Do not infer a universal process-per-chat guarantee or implement a shared-thread
router solely for a possible future protocol.

## Executable contracts, without audio

`tests/expression-capability-e2e.test.mjs` verifies actual stdio MCP, Rust gateway
and renderer ownership: a second controller gets HTTP409, cancellation changes
epoch, stale work is rejected, and a duplicate request does not apply again.
An initial applied count of exactly one prevents a vacuous replay assertion.
These are engine/controller checks, not Native chat identity or pixel recognition.

`tests/live-conversation-host.test.mjs` verifies the production WebSocket relay
and broker with a scripted Native peer. Normal text is held until user revocation,
then forwarded once to the selected thread. Canonical duplicate user items become
one row; foreign/realtime events are not resubmitted. This is useful if a verified
Native Dictate client sends normal `turn/start` through that same relay. It does
not prove that Desktop currently does so. No model or speech recognition is used.

## Smallest next integration, conditional on the target client

First inspect the user's actual Desktop version and selected conversation without
opening a microphone. Verify its supported MCP configuration and host-authored
thread context, then explicitly pair one permitted thread with a Fisch controller.
Keep existing loopback authentication, epoch fencing and controller exclusivity;
never authorize from a model-supplied thread label or replay recognized text.

Only add a narrow host/session adapter once that route is demonstrated. Desktop
conversation projection and user/speech-start priority are separate gaps: standard
MCP tool calls alone do not expose all earlier user input. If lifecycle events
cannot be observed, report that limit instead of promising the private TUI's
pre-dispatch barrier. Native Windows Dictate, Vietnamese recognition, microphone
permissions and natural UX remain untested; there is no external STT fallback.
