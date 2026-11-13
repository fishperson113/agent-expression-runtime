---
kind: object
universe: live
status: verified
verified_at: 2026-11-13
source_revision: e1bd851
---
# Conversation - MAIN and the observer are different lanes

## Why this shape
The browser chat reaches the Native Codex coding thread. The observer is separate
and unprivileged; a bounded public conversation brief is not full coding history.

## Shape and source
- [LiveConversation](../../../integrations/live-conversation.mjs) owns the native
  panel conversation and its bounded public context, including freshness/revocation.
- [transport](../../../integrations/live-codex-transport.mjs) connects native events.
- [LiveReactiveBroker](../../../integrations/live-reactive-broker.mjs) coordinates
  browser-authorized observer requests with the bounded context source.
- [conversation view](../../../src/live/conversation-view.ts) renders panel chat.
  Its `messageRows` reconciler retains DOM rows by generation/turn/item/role and
  edits plaintext in place; it does not execute streamed JSON or tool arguments.
  See [projection scope](../../chat-stream-projection.md) and
  [view tests](../../../tests/conversation-view.test.mjs) for reading/selection checks.

## Connected to
MAIN can author an expression; observer decisions still pass [Live body](live-body.md)
causality/ownership checks. A completed text reply is not proof a frame was drawn.

## If you change this
Hits: chat lifecycle, context freshness, cancellation/retry notices, broker tests.
Does not hit: core geometry primitives simply because model wording changes.

## Surfaces
User panel/native terminal, Codex transport, bounded public brief to observer.
Keep credentials, full coding history and real camera images out of diagnostics.

## See
[Live guide](../../fisch-live.md),
[conversation tests](../../../tests/live-conversation.test.mjs),
[broker tests](../../../tests/live-reactive-broker.test.mjs).
