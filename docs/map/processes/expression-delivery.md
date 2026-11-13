---
kind: process
universe: live
status: verified
verified_at: 2026-11-13
source_revision: e1bd851
---
# Expression delivery - from a chat intent to a visible body

## Input
User text through the panel, or an authorized fresh observer request.
Consumes [conversation](../objects/conversation.md).

## Movement
1. [LiveConversation](../../../integrations/live-conversation.mjs) sends chat to
   Codex; [tool catalog](../../../integrations/live-tools.mjs) exposes expression
   capabilities. Text completion alone does not establish expression success.
2. [Composition](../../../integrations/compose-expression.mjs) expands declarative
   input; [gateway](../../../src-tauri/src/gateway.rs) and
   [browser bridge](../../../src/live/bridge.ts) deliver it for admission.
3. [LiveBody](../../../src/live/body.ts) compiles/adopts the program subject to
   current ownership and epoch. [Scheduler](../../../src/core/runtime/scheduler.ts)
   and [renderer](../../../src/adapters/three-renderer.ts) execute/draw.
4. Observer work travels through [broker](../../../integrations/live-reactive-broker.mjs)
   and [decision host](../../../src/core/live/decision-host.ts), not by blindly
   looping the MAIN coding thread. Stale work does not gain authority from this map.

## Output
Produces a lifecycle receipt and potentially a visible [body](../objects/live-body.md).
An accepted receipt, completed trajectory and actual visible frames are different
claims. [Admission semantics](../../admission.md) owns their detailed contract.

## If you change this
Hits: involved owner cards and [composition E2E](../../../tests/expression-composition-e2e.test.mjs).
Does not hit: an invented voice/STT/TTS pipeline; none is introduced here.

## Check
Run relevant tests from linked cards plus normal architecture/build/harness gates.
For a visual claim inspect an actual continuous render; synthetic tests are not
human enjoyment or real-camera acceptance.
