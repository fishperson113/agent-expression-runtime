# Fisch system map - find the owner before editing

This map is an ICM context layer for coding agents, not the realtime runtime.
The source tree owns behavior; cards cite it instead of becoming another spec.

| Task | Open |
| --- | --- |
| How to use/update this map | [Contract](CONTEXT.md) |
| DSL input, motion or rendering | [Expression](objects/expression.md) |
| Chat, Codex, bounded observer context | [Conversation](objects/conversation.md) |
| Ownership, cancellation, presentation timing | [Live body](objects/live-body.md) |
| Trace a chat-to-expression flow | [Expression delivery](processes/expression-delivery.md) |
| Find first-order change impact | [Impact routing](effects/CONTEXT.md) |

Names: MAIN is the interactive coding conversation; observer is the separate
unprivileged model lane. `LiveBody` is the browser composition owner, not the
language model. `compose_expression` is authoring input, not compiler IR.
